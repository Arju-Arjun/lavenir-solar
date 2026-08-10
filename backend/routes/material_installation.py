from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import MaterialInstallation, db, User, CustomerProject, CustomerAuditLog, SiteVisit
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

installation_bp = Blueprint('installation', __name__)
MODULE_NAME = 'Material Installation'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'materialinstallation'

@installation_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    return handle_blueprint_check_access(uid, MODULE_NAME)

@installation_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)

def _serialize_installation(installation):
    return {
        "id": installation.id,
        "customer_project_id": installation.customer_project_id,
        "electrical_installed": installation.electrical_installed,
        "structure_installed": installation.structure_installed,
        "installation_team": installation.installation_team,
        "installation_completion_date": installation.installation_completion_date.isoformat() if installation.installation_completion_date else None,
        "comments": installation.comments,
        "installation_images": json.loads(installation.installation_images) if installation.installation_images else [],
        "installation_document": installation.installation_document,
        "work_done": installation.work_done,
        "created_at": installation.created_at.isoformat() if installation.created_at else None,
        "created_by": installation.created_by,
        "updated_at": installation.updated_at.isoformat() if installation.updated_at else None,
        "updated_by": installation.updated_by
    }

def _parse_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ['true', '1', 'yes', 'on']

def _file_ext(filename, default='bin'):
    return filename.rsplit('.', 1)[-1] if '.' in filename else default

@installation_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_material_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'view', MODULE_NAME):
        return jsonify({"error": "Unauthorized permission profile view parameters."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project reference metrics missing."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=customer_project.id).first()
    changes = site_visit.changes if site_visit else None
    installation = customer_project.material_installation_rel
    if not installation:
        return jsonify({"installation": None}), 200

    return jsonify({
        "installation": _serialize_installation(installation),
        "site_visit_changes": changes
    }), 200

@installation_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def create_material_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized submission mapping."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project:
        return jsonify({"error": "Customer project data target parameters not found."}), 404

    if customer_project.material_installation_rel:
        # CHANGED: a MaterialInstallation stub row now gets auto-created for
        # every customer at customer-creation time (see customers.py
        # create_customer()), so this branch is ALWAYS true from day one -
        # the old "already initialized, use update instead" 400 would block
        # every first-time real save. Redirect to the update handler
        # instead, matching the exact pattern material.py's
        # create_material_delivery() already uses for this same situation.
        return update_material_installation(customer_id)

    delivery = customer_project.material_delivery_rel
    # CHANGED: was `if not customer_project.material_delivery_rel:` (a bare
    # existence check). MaterialDelivery now gets an auto-created stub row
    # for every customer at customer-creation time, so that existence check
    # would never block anything anymore - this checks whether delivery is
    # actually confirmed (the same three flags every other delivery-related
    # check in this codebase reads) instead.
    if not delivery or not (delivery.electrical_delivered and delivery.structure_delivered and delivery.panel_delivered):
        return jsonify({"error": "Material delivery details must be recorded before installation can begin."}), 400

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/materialinstallation
    folder_path = get_module_folder_path(customer_project.customer_name, customer_project.customer_id, FOLDER_MODULE_NAME)

    form = request.form
    files = request.files

    electrical_installed = _parse_bool(form.get('electrical_installed'))
    structure_installed = _parse_bool(form.get('structure_installed'))

    completion_date_str = form.get('installation_completion_date')
    completion_date = None
    if completion_date_str:
        try:
            completion_date = datetime.strptime(completion_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"error": "Invalid calendar parameter formatting type inputs."}), 400

    installation = MaterialInstallation(
        customer_project_id=customer_project.id,
        electrical_installed=electrical_installed,
        structure_installed=structure_installed,
        installation_team=form.get('installation_team'),
        installation_completion_date=completion_date,
        comments=form.get('comments'),
        created_by=user.id
    )

    doc_file = files.get('installation_document')
    if doc_file and doc_file.filename != '':
        ext = _file_ext(doc_file.filename)
        object_key = (
            f"{folder_path}/{sanitize_path_segment('installation_document')}"
            f"_{sanitize_path_segment(customer_project.customer_id)}.{ext}"
        )
        installation.installation_document = upload_to_r2(doc_file, object_key, content_type=doc_file.mimetype)

    uploaded_urls = []
    for i, photo in enumerate(files.getlist('installation_images')):
        if photo and photo.filename != '':
            ext = _file_ext(photo.filename, default='jpg')
            object_key = f"{folder_path}/photo{i + 1}_{sanitize_path_segment(customer_project.customer_id)}.{ext}"
            uploaded_urls.append(upload_to_r2(photo, object_key, content_type=photo.mimetype))
    installation.installation_images = json.dumps(uploaded_urls)

    installation.work_done = "Completed" if (electrical_installed and structure_installed and len(uploaded_urls) > 0) else "Pending"
    
    db.session.add(installation)
    try:
        # Flush (not commit) so the unique constraint on customer_project_id
        # is checked now. If a concurrent request already created the
        # installation row for this customer between our earlier
        # `material_installation_rel` check and this INSERT, this raises
        # IntegrityError instead of racing to create a second row.
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return update_material_installation(customer_id)

    audit_log = CustomerAuditLog(
        customer_project_id=customer_project.id,
        user_id=uid,
        action="CREATE",
        module_name=MODULE_NAME,
        changes_payload=json.dumps({"created": True})
    )
    db.session.add(audit_log)
    db.session.commit()

    return jsonify({"message": "Material installation ledger data created successfully.", "installation": _serialize_installation(installation)}), 201

@installation_bp.route('/<string:customer_id>/', methods=['PUT'])
@jwt_required()
def update_material_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized write authentication layers."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project or not customer_project.material_installation_rel:
        return jsonify({"error": "No installation logs schema map found."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/materialinstallation
    folder_path = get_module_folder_path(customer_project.customer_name, customer_project.customer_id, FOLDER_MODULE_NAME)

    installation = customer_project.material_installation_rel
    form = request.form
    files = request.files
    changes = {}

    def track(field, old_val, new_val):
        if old_val != new_val:
            changes[field] = {"old": old_val, "new": new_val}

    new_electrical = _parse_bool(form.get('electrical_installed'))
    track('electrical_installed', installation.electrical_installed, new_electrical)
    installation.electrical_installed = new_electrical

    new_structure = _parse_bool(form.get('structure_installed'))
    track('structure_installed', installation.structure_installed, new_structure)
    installation.structure_installed = new_structure

    for field in ['installation_team', 'comments']:
        if field in form:
            new_val = form.get(field)
            track(field, getattr(installation, field), new_val)
            setattr(installation, field, new_val)

    completion_date_str = form.get('installation_completion_date')
    if completion_date_str:
        try:
            new_date = datetime.strptime(completion_date_str, '%Y-%m-%d').date()
            track('installation_completion_date', str(installation.installation_completion_date), str(new_date))
            installation.installation_completion_date = new_date
        except ValueError:
            return jsonify({"error": "Invalid date string entry data."}), 400

    doc_file = files.get('installation_document')
    if doc_file and doc_file.filename != '':
        old_doc = installation.installation_document
        delete_r2_file(old_doc)
        ext = _file_ext(doc_file.filename)
        object_key = (
            f"{folder_path}/{sanitize_path_segment('installation_document')}"
            f"_{sanitize_path_segment(customer_project.customer_id)}.{ext}"
        )
        new_doc_url = upload_to_r2(doc_file, object_key, content_type=doc_file.mimetype)
        track('installation_document', old_doc, new_doc_url)
        installation.installation_document = new_doc_url

    existing_images = json.loads(installation.installation_images) if installation.installation_images else []
    new_uploaded_urls = []
    # Continue numbering from where the existing image list left off so each
    # image gets a unique object key within the same module folder.
    start_index = len(existing_images) + 1
    for i, photo in enumerate(files.getlist('installation_images')):
        if photo and photo.filename != '':
            ext = _file_ext(photo.filename, default='jpg')
            object_key = f"{folder_path}/photo{start_index + i}_{sanitize_path_segment(customer_project.customer_id)}.{ext}"
            new_uploaded_urls.append(upload_to_r2(photo, object_key, content_type=photo.mimetype))

    removed_images = json.loads(form.get('removed_images', '[]')) if 'removed_images' in form else []
    final_images = [img for img in existing_images if img not in removed_images] + new_uploaded_urls

    for removed_url in removed_images:
        delete_r2_file(removed_url)

    if new_uploaded_urls or removed_images:
        changes['installation_images'] = {"added": new_uploaded_urls, "removed": removed_images}

    installation.installation_images = json.dumps(final_images)
    installation.updated_by = user.id
    installation.updated_at = datetime.utcnow()

    new_work_done = "Completed" if (installation.electrical_installed and installation.structure_installed and len(final_images) > 0) else "Pending"
    track('work_done', installation.work_done, new_work_done)
    installation.work_done = new_work_done

    if changes:
        audit_log = CustomerAuditLog(
            customer_project_id=customer_project.id,
            user_id=uid,
            action="UPDATE",
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes)
        )
        db.session.add(audit_log)

    db.session.commit()

    return jsonify({"message": "Material installation logs tracking matrix updated safely.", "installation": _serialize_installation(installation)}), 200

@installation_bp.route('/<string:customer_id>/', methods=['DELETE'])
@jwt_required()
def delete_material_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not permission_allows_for_user(user, 'delete', MODULE_NAME):
        return jsonify({"error": "Unauthorized action clearance."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project or not customer_project.material_installation_rel:
        return jsonify({"error": "Material installation details logs structure missing."}), 404

    installation = customer_project.material_installation_rel
    delete_r2_file(installation.installation_document)
    if installation.installation_images:
        for img in json.loads(installation.installation_images):
            delete_r2_file(img)

    db.session.delete(installation)

    audit_log = CustomerAuditLog(
        customer_project_id=customer_project.id,
        user_id=uid,
        action="DELETE",
        module_name=MODULE_NAME,
        changes_payload=json.dumps({"deleted": True})
    )
    db.session.add(audit_log)
    db.session.commit()

    return jsonify({"message": "Material installation matrix destroyed cleanly."}), 200