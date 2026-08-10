from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import MaterialDelivery, MaterialDeliveryItem, db, User, CustomerProject, SiteVisit, CustomerAuditLog
from datetime import datetime
from sqlalchemy.exc import IntegrityError
import json
from utils import (
    check_permission, 
    permission_allows_for_user,
    delete_r2_file,
    upload_to_r2,
    handle_blueprint_check_access,
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment
)

material_bp = Blueprint('material', __name__)
MODULE_NAME = 'Material Delivery'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'materialdelivery'

@material_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    return handle_blueprint_check_access(uid, MODULE_NAME)

@material_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)

def _serialize_delivery(material_delivery):
    return {
        "id": material_delivery.id,
        "delivery_date": material_delivery.delivery_date.isoformat() if material_delivery.delivery_date else None,
        "electrical_delivered": material_delivery.electrical_delivered,
        "structure_delivered": material_delivery.structure_delivered,
        "panel_delivered": material_delivery.panel_delivered,
        "changes": material_delivery.changes,
        "extra_material": material_delivery.extra_material,
        "structure_changes": material_delivery.structure_changes,
        "delivery_images": json.loads(material_delivery.delivery_images) if material_delivery.delivery_images else [],
        "delivery_document": json.loads(material_delivery.delivery_document) if material_delivery.delivery_document else [],
        "delivered_by": material_delivery.delivered_by,
        "received_by": material_delivery.received_by,
        "comments": material_delivery.comments,
        "work_done": material_delivery.work_done
    }

def _parse_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ['true', '1', 'yes', 'on']

def _file_ext(filename, default='bin'):
    return filename.rsplit('.', 1)[-1] if '.' in filename else default

# Valid categories for an individual material item. ("Both" is a
# frontend-only filter option meaning "no category filter", never a value
# stored on a row.) "Extra Items" is a special category for rows added from
# the Usage/Installation tab that aren't part of the original delivered
# inventory — the frontend renders these in a separate "Extra Items" table.
ALLOWED_ITEM_CATEGORIES = {'Electrical', 'Structural', 'Extra Items'}

def _normalize_category(raw_value, fallback='Electrical'):
    # .title() (not .capitalize()) so multi-word categories like
    # "Extra Items" keep every word capitalized — .capitalize() would
    # lowercase it to "Extra items", which wouldn't match the set above and
    # would silently fall back to "Electrical".
    value = (raw_value or '').strip().title()
    return value if value in ALLOWED_ITEM_CATEGORIES else fallback

def _upload_documents(received_documents, folder_path, customer_id, start_index=1):
    """Upload any number of files of any type (pdf, image, docx, xlsx, etc.)
    for the delivery_document field. R2 stores whatever comes in without
    branching on extension/mimetype - the original filename's extension is
    kept on the object key."""
    uploaded_urls = []
    for i, doc in enumerate(received_documents):
        if doc and doc.filename != '':
            ext = _file_ext(doc.filename)
            object_key = f"{folder_path}/doc{start_index + i}_{sanitize_path_segment(customer_id)}.{ext}"
            uploaded_urls.append(upload_to_r2(doc, object_key, content_type=doc.mimetype))
    return uploaded_urls

@material_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_material_delivery(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'view', MODULE_NAME):
        return jsonify({"error": "Unauthorized module access parameters."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project not found."}), 404
    
    site_visit = SiteVisit.query.filter_by(customer_project_id=customer_project.id).first()
    changes = site_visit.changes if site_visit else None
    material_delivery = customer_project.material_delivery_rel
    

    if not material_delivery:
        return jsonify({"delivery": None, "site_visit_changes": changes}), 200

    return jsonify({"delivery": _serialize_delivery(material_delivery), "site_visit_changes": changes}), 200

@material_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def create_material_delivery(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized submission cleared."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project records missing."}), 404

    # Always delegate to update_material_delivery, whether or not a row
    # exists yet. It already has its own "auto-create a stub row if missing"
    # branch (below) that stays race-safe under the unique constraint, and
    # it's the ONLY code path that persists the `items` table on save. This
    # used to duplicate that create logic here WITHOUT the items-handling
    # block, so a legacy customer's very first delivery save (with items
    # already filled in on the form) silently dropped the items - nothing
    # in that branch ever touched them.
    return update_material_delivery(customer_id)

@material_bp.route('/<string:customer_id>/', methods=['PUT'])
@jwt_required()
def update_material_delivery(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized modification context."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project records missing."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/materialdelivery
    folder_path = get_module_folder_path(customer_project.customer_name, customer_project.customer_id, FOLDER_MODULE_NAME)

    material_delivery = customer_project.material_delivery_rel
    form = request.form
    files = request.files
    changes = {}
    created_new_delivery = False

    if not material_delivery:
        # No "General Delivery" record exists yet for this customer. Rather
        # than blocking the save (previous behavior), auto-create a bare
        # record here so material items can be entered standalone. The
        # delivery-level fields (dates, images, delivered flags, etc.) can
        # still be filled in later via the main Material Delivery form.
        material_delivery = MaterialDelivery(
            customer_project_id=customer_project.id,
            # No delivery_date here — this is a bare stub created because
            # items were entered before the user touched the actual
            # "Delivery Date" field. Defaulting it to today's date made the
            # field show a date the user never picked, the very next time
            # they opened this tab to edit anything else. Leave it null
            # until the user explicitly sets it below.
            electrical_delivered=False,
            structure_delivered=False,
            panel_delivered=False,
            delivery_images=json.dumps([]),
            delivery_document=json.dumps([]),
            created_by=user.id,
            updated_by=user.id
        )
        db.session.add(material_delivery)
        try:
            # Flush (not commit) so the unique constraint on
            # customer_project_id is checked now. If a concurrent request
            # already inserted a row for this customer between our lookup
            # above and this INSERT (e.g. two rapid saves from
            # MaterialItem.jsx and the main form), this raises
            # IntegrityError instead of racing to create a second row.
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
            material_delivery = MaterialDelivery.query.filter_by(customer_project_id=customer_project.id).first()
            if not material_delivery:
                return jsonify({"error": "Could not save delivery record due to a conflicting update. Please try again."}), 409
        created_new_delivery = True
        changes['delivery_record'] = {"old": None, "new": "auto-created"}

    def track(field, old_val, new_val):
        if old_val != new_val:
            changes[field] = {"old": old_val, "new": new_val}

    delivery_date_str = form.get('delivery_date')
    if delivery_date_str:
        try:
            delivery_date = datetime.strptime(delivery_date_str, '%Y-%m-%d').date()
            track('delivery_date', str(material_delivery.delivery_date), str(delivery_date))
            material_delivery.delivery_date = delivery_date
        except ValueError:
            return jsonify({"error": "Invalid date format setup criteria."}), 400

    for field in ['electrical_delivered', 'structure_delivered', 'panel_delivered']:
        if field in form:
            val = _parse_bool(form.get(field))
            track(field, getattr(material_delivery, field), val)
            setattr(material_delivery, field, val)

    for field in ['changes', 'extra_material', 'structure_changes', 'delivered_by', 'received_by', 'comments']:
        if field in form:
            new_val = form.get(field)
            track(field, getattr(material_delivery, field), new_val)
            setattr(material_delivery, field, new_val)

    # --- Images: add new uploads, drop any explicitly removed ---
    existing_images = json.loads(material_delivery.delivery_images) if material_delivery.delivery_images else []
    new_uploaded_urls = []
    received_images = files.getlist('delivery_images') or files.getlist('images')
    # Continue numbering from where the existing image list left off so each
    # image gets a unique object key within the same module folder.
    start_index = len(existing_images) + 1
    for i, photo in enumerate(received_images):
        if photo and photo.filename != '':
            ext = _file_ext(photo.filename, default='jpg')
            object_key = f"{folder_path}/photo{start_index + i}_{sanitize_path_segment(customer_project.customer_id)}.{ext}"
            new_uploaded_urls.append(upload_to_r2(photo, object_key, content_type=photo.mimetype))

    removed_images = json.loads(form.get('removed_images', '[]')) if 'removed_images' in form else []
    final_images = [img for img in existing_images if img not in removed_images] + new_uploaded_urls

    for removed_url in removed_images:
        delete_r2_file(removed_url)

    if new_uploaded_urls or removed_images:
        changes['delivery_images'] = {"added": new_uploaded_urls, "removed": removed_images}

    # --- Documents: same add/remove pattern as images, multiple files and
    # multiple file types (pdf, docx, xlsx, images, ...) all accepted ---
    existing_documents = json.loads(material_delivery.delivery_document) if material_delivery.delivery_document else []
    received_documents = files.getlist('delivery_document') or files.getlist('documents')
    start_doc_index = len(existing_documents) + 1
    new_document_urls = _upload_documents(
        received_documents, folder_path, customer_project.customer_id, start_index=start_doc_index
    )

    removed_documents = json.loads(form.get('removed_documents', '[]')) if 'removed_documents' in form else []
    final_documents = [doc for doc in existing_documents if doc not in removed_documents] + new_document_urls

    for removed_doc in removed_documents:
        delete_r2_file(removed_doc)

    if new_document_urls or removed_documents:
        changes['delivery_document'] = {"added": new_document_urls, "removed": removed_documents}

    # --- Persist the material items table (previously ignored entirely) ---
    items_json = form.get('items')
    if items_json is not None:
        try:
            items_data = json.loads(items_json)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid items payload format."}), 400

        # Reject duplicate rows (same material name + category) before
        # touching the database, so a bad submission never partially saves.
        seen_keys = set()
        for item in items_data:
            name_key = (item.get('material_name') or '').strip().lower()
            if not name_key:
                continue
            category_key = _normalize_category(item.get('category')).lower()
            dup_key = (name_key, category_key)
            if dup_key in seen_keys:
                return jsonify({
                    "error": f"Duplicate material item '{item.get('material_name')}' "
                             f"({_normalize_category(item.get('category'))}) found in submitted items."
                }), 400
            seen_keys.add(dup_key)

        existing_items = {i.id: i for i in material_delivery.material_items}
        incoming_ids = {item.get('id') for item in items_data if item.get('id')}

        # Remove rows the user deleted on the frontend
        for item_id, item_obj in existing_items.items():
            if item_id not in incoming_ids:
                db.session.delete(item_obj)

        for idx, item in enumerate(items_data):
            try:
                quantity = float(item.get('quantity') or 0)
            except (TypeError, ValueError):
                quantity = 0.0

            item_id = item.get('id')
            if item_id and item_id in existing_items:
                # Update existing row, keep used/remaining unless quantity changed
                row = existing_items[item_id]
                row.sl_no = item.get('sl_no', idx + 1)
                row.material_name = item.get('material_name', row.material_name)
                row.unit = item.get('unit', row.unit)
                row.category = _normalize_category(item.get('category'), fallback=row.category or 'Electrical')
                if quantity != row.quantity:
                    row.quantity = quantity
                    row.remaining_quantity = max(0.0, quantity - (row.used_quantity or 0.0))
            else:
                # New row added on the frontend
                db.session.add(MaterialDeliveryItem(
                    material_delivery_id=material_delivery.id,
                    sl_no=item.get('sl_no', idx + 1),
                    material_name=item.get('material_name', ''),
                    unit=item.get('unit', 'Nos'),
                    category=_normalize_category(item.get('category')),
                    quantity=quantity,
                    used_quantity=0.0,
                    remaining_quantity=quantity
                ))

        changes['items'] = {"count": len(items_data)}

    material_delivery.delivery_images = json.dumps(final_images)
    material_delivery.delivery_document = json.dumps(final_documents)
    material_delivery.updated_by = user.id
    material_delivery.updated_at = datetime.utcnow()
    
    material_delivery.work_done = "Completed" if (material_delivery.electrical_delivered and material_delivery.structure_delivered and material_delivery.panel_delivered and len(final_images) > 0) else "Pending"

    if changes:
        audit_log = CustomerAuditLog(
            customer_project_id=customer_project.id,
            user_id=uid,
            action="CREATE" if created_new_delivery else "UPDATE",
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes)
        )
        db.session.add(audit_log)

    db.session.commit()

    message = "Delivery record created and items saved successfully." if created_new_delivery else "Delivery logs updated smoothly."
    return jsonify({"message": message, "delivery": _serialize_delivery(material_delivery)}), 200