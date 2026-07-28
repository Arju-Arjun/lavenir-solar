from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import MaterialDelivery, MaterialDeliveryItem, db, User, CustomerProject, SiteVisit, CustomerAuditLog
from datetime import datetime
import cloudinary
import cloudinary.uploader
import json
from utils import (
    check_permission, 
    delete_cloudinary_file,
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
        "delivery_document": material_delivery.delivery_document,
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

@material_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_material_delivery(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not check_permission(uid, 'view', MODULE_NAME):
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
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized submission cleared."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project records missing."}), 404

    if customer_project.material_delivery_rel:
        # A delivery record may already exist here even if the user never
        # touched the main delivery form — e.g. it gets auto-created when
        # material items are saved first via MaterialItem.jsx. Rather than
        # forcing the frontend to know which verb to call, treat this as an
        # update instead of failing.
        return update_material_delivery(customer_id)

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/materialdelivery
    folder_path = get_module_folder_path(customer_project.customer_name, customer_project.customer_id, FOLDER_MODULE_NAME)

    form = request.form
    files = request.files

    delivery_date_str = form.get('delivery_date')
    try:
        delivery_date = datetime.strptime(delivery_date_str, '%Y-%m-%d').date() if delivery_date_str else datetime.utcnow().date()
    except ValueError:
        return jsonify({"error": "Invalid date string format parameters."}), 400

    delivery_document_url = None
    doc_file = files.get('delivery_document')
    if doc_file and doc_file.filename != '':
        # public_id -> "{doctype}_{customer_id}" (Cloudinary appends the
        # extension automatically), giving lavenir/{customer}_{id}/materialdelivery/{doctype}_{id}.{ext}
        public_id = f"{sanitize_path_segment('delivery_document')}_{sanitize_path_segment(customer_project.customer_id)}"
        upload_res = cloudinary.uploader.upload(
            doc_file, folder=folder_path, public_id=public_id, overwrite=True, resource_type="auto"
        )
        delivery_document_url = upload_res['secure_url']

    image_urls = []
    received_images = files.getlist('delivery_images') or files.getlist('images')
    for i, photo in enumerate(received_images):
        if photo and photo.filename != '':
            public_id = f"photo{i + 1}_{sanitize_path_segment(customer_project.customer_id)}"
            upload_res = cloudinary.uploader.upload(
                photo, folder=folder_path, public_id=public_id, overwrite=True
            )
            image_urls.append(upload_res['secure_url'])

    new_delivery = MaterialDelivery(
        customer_project_id=customer_project.id,
        delivery_date=delivery_date,
        electrical_delivered=_parse_bool(form.get('electrical_delivered')),
        structure_delivered=_parse_bool(form.get('structure_delivered')),
        panel_delivered=_parse_bool(form.get('panel_delivered')),
        changes=form.get('changes'),
        extra_material=form.get('extra_material'),
        structure_changes=form.get('structure_changes'),
        delivery_images=json.dumps(image_urls),
        delivery_document=delivery_document_url,
        delivered_by=form.get('delivered_by'),
        received_by=form.get('received_by'),
        comments=form.get('comments'),
        created_by=user.id,
        updated_by=user.id
    )

    new_delivery.work_done = "Completed" if (new_delivery.electrical_delivered and new_delivery.structure_delivered and new_delivery.panel_delivered and len(image_urls) > 0) else "Pending"
    
    db.session.add(new_delivery)
    db.session.commit()

    audit_log = CustomerAuditLog(
        customer_project_id=customer_project.id,
        user_id=uid,
        action="CREATE",
        module_name=MODULE_NAME,
        changes_payload=json.dumps({"initialized": True})
    )
    db.session.add(audit_log)
    db.session.commit()

    return jsonify({"message": "Delivery mapping initialized successfully.", "delivery": _serialize_delivery(new_delivery)}), 201

@material_bp.route('/<string:customer_id>/', methods=['PUT'])
@jwt_required()
def update_material_delivery(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
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
            delivery_date=datetime.utcnow().date(),
            electrical_delivered=False,
            structure_delivered=False,
            panel_delivered=False,
            delivery_images=json.dumps([]),
            created_by=user.id,
            updated_by=user.id
        )
        db.session.add(material_delivery)
        db.session.flush()  # assigns material_delivery.id for use below, no commit yet
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

    doc_file = files.get('delivery_document')
    if doc_file and doc_file.filename != '':
        old_doc = material_delivery.delivery_document
        delete_cloudinary_file(old_doc, folder_path)
        public_id = f"{sanitize_path_segment('delivery_document')}_{sanitize_path_segment(customer_project.customer_id)}"
        upload_res = cloudinary.uploader.upload(
            doc_file, folder=folder_path, public_id=public_id, overwrite=True, resource_type="auto"
        )
        track('delivery_document', old_doc, upload_res['secure_url'])
        material_delivery.delivery_document = upload_res['secure_url']

    existing_images = json.loads(material_delivery.delivery_images) if material_delivery.delivery_images else []
    new_uploaded_urls = []
    received_images = files.getlist('delivery_images') or files.getlist('images')
    # Continue numbering from where the existing image list left off so each
    # image gets a unique public_id within the same module folder.
    start_index = len(existing_images) + 1
    for i, photo in enumerate(received_images):
        if photo and photo.filename != '':
            public_id = f"photo{start_index + i}_{sanitize_path_segment(customer_project.customer_id)}"
            upload_res = cloudinary.uploader.upload(
                photo, folder=folder_path, public_id=public_id, overwrite=True
            )
            new_uploaded_urls.append(upload_res['secure_url'])

    removed_images = json.loads(form.get('removed_images', '[]')) if 'removed_images' in form else []
    final_images = [img for img in existing_images if img not in removed_images] + new_uploaded_urls

    for removed_url in removed_images:
        delete_cloudinary_file(removed_url, folder_path)

    if new_uploaded_urls or removed_images:
        changes['delivery_images'] = {"added": new_uploaded_urls, "removed": removed_images}

    # --- Persist the material items table (previously ignored entirely) ---
    items_json = form.get('items')
    if items_json is not None:
        try:
            items_data = json.loads(items_json)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid items payload format."}), 400

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
                    quantity=quantity,
                    used_quantity=0.0,
                    remaining_quantity=quantity
                ))

        changes['items'] = {"count": len(items_data)}

    material_delivery.delivery_images = json.dumps(final_images)
    material_delivery.updated_by = user.id
    material_delivery.updated_at = datetime.utcnow()
    
    material_delivery.work_done = "Completed" if (material_delivery.electrical_delivered and material_delivery.structure_delivered and material_delivery.panel_delivered and len(final_images) > 0) else "Pending"

    db.session.commit()

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