from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, PermissionRequest, CustomerProject, DCRCertificate, CustomerAuditLog
from datetime import datetime
import json
from utils import (
    check_permission, 
    delete_r2_file,
    upload_to_r2,
    handle_blueprint_check_access,
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment
)

dcr_bp = Blueprint('dcr_bp', __name__)

MODULE_NAME = 'DCR Details'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'dcr'

def str_to_bool(val):
    if isinstance(val, str):
        return val.lower() in ['true', '1', 'yes']
    return bool(val)

@dcr_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_module_access():
    uid = get_jwt_identity()
    # Automatically queries base permission matrix and unhandled pending authorization requests
    return handle_blueprint_check_access(uid, MODULE_NAME)


@dcr_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@dcr_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_dcr_certificate(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
        return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"dcr": None, "message": "Customer matching identity not found."}), 404

    dcr = DCRCertificate.query.filter_by(customer_project_id=customer.id).first()
    if not dcr:
        return jsonify({"dcr": None}), 200
        
    return jsonify({"dcr": dcr.to_dict()}), 200


@dcr_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_dcr_certificate(customer_id):
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'

        customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not customer:
            return jsonify({"message": "Customer record could not be resolved."}), 404

        # Centralized storage folder for this customer + module, e.g.:
        # lavenir/JohnDoe_1023/dcr
        folder_path = get_module_folder_path(customer.customer_name, customer.customer_id, FOLDER_MODULE_NAME)

        dcr = DCRCertificate.query.filter_by(customer_project_id=customer.id).first()
        action_type = "UPDATE" if dcr else "CREATE"

        if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
            return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

        if not dcr:
            dcr = DCRCertificate(customer_project_id=customer.id, created_by=current_user_id)
            db.session.add(dcr)

        changes = {}

        for field in ['certificate_received', 'certificate_claimed', 'certificate_sold']:
            if field in request.form:
                old_val = getattr(dcr, field)
                new_val = str_to_bool(request.form.get(field))
                if old_val != new_val:
                    changes[field] = {"old": old_val, "new": new_val}
                    setattr(dcr, field, new_val)

        if 'comments' in request.form:
            new_comments = request.form.get('comments')
            old_comments = getattr(dcr, 'comments') or ""
            if old_comments != new_comments:
                changes['comments'] = {"old": old_comments, "new": new_comments}
                dcr.comments = new_comments

        if 'certificate_file' in request.files:
            file_obj = request.files['certificate_file']
            if file_obj and file_obj.filename != '':
                old_file_url = dcr.certificate_file

                # Upload the replacement first and only delete the old file
                # once the new one is confirmed on R2, so a failed upload
                # never leaves the customer with no file at all.
                ext = file_obj.filename.rsplit('.', 1)[-1] if '.' in file_obj.filename else 'bin'
                object_key = (
                    f"{folder_path}/{sanitize_path_segment('certificate_file')}"
                    f"_{sanitize_path_segment(customer.customer_id)}.{ext}"
                )
                new_file_url = upload_to_r2(file_obj, object_key, content_type=file_obj.mimetype)
                if old_file_url:
                    delete_r2_file(old_file_url)
                changes['certificate_file'] = {"old": old_file_url, "new": new_file_url}
                dcr.certificate_file = new_file_url

        old_work_done = dcr.work_done
        dcr.work_done = "Completed" if (dcr.certificate_received and dcr.certificate_file) else "Pending"
        if old_work_done != dcr.work_done:
            changes['work_done'] = {"old": old_work_done, "new": dcr.work_done}

        dcr.updated_by = current_user_id
        dcr.updated_at = datetime.utcnow()

        if changes or action_type == "CREATE":
            audit_log = CustomerAuditLog(
                customer_project_id=customer.id,
                user_id=current_user_id,
                action=action_type,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {"initialized": True})
            )
            db.session.add(audit_log)

        db.session.commit()

        return jsonify({"message": "DCR certificate synchronized successfully", "dcr": dcr.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Save failed: {str(e)}"}), 500