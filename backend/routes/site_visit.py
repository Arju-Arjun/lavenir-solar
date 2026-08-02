from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, SiteVisit, CustomerProject, CustomerAuditLog, PermissionRequest
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

site_visit_bp = Blueprint('site_visit_bp', __name__)

MODULE_NAME = 'Site Visit'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'sitevisit'


@site_visit_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_module_access():
    current_user_id = get_jwt_identity()
    # Leverages centralized utility handler which includes pending requests map
    return handle_blueprint_check_access(current_user_id, MODULE_NAME)


@site_visit_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    current_user_id = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(current_user_id, MODULE_NAME, data)


@site_visit_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_site_visit(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
        return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403
        
    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"visit": None, "message": "Customer matching identity not found."}), 404

    visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
    if not visit:
        return jsonify({"visit": None}), 200
    return jsonify({"visit": visit.to_dict()}), 200


@site_visit_bp.route('/<string:customer_id>/', methods=['POST', 'PUT'])
@jwt_required()
def save_site_visit(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"message": "Customer record could not be resolved."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/sitevisit
    folder_path = get_module_folder_path(customer.customer_name, customer.customer_id, FOLDER_MODULE_NAME)

    visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
    action_type = "UPDATE" if visit else "CREATE"
    
    if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
        return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

    try:
        if not visit:
            visit = SiteVisit(customer_project_id=customer.id, created_by=current_user_id)
            db.session.add(visit)

        changes = {}
        text_fields = [
            'panel_capacity', 'system_capacity', 'feasibility', 'project_cost', 
            'location', 'comments', 'ownership_change', 'load_enhancement', 'wifi', 'changes'
        ]
        
        for field in text_fields:
            if field in request.form:
                new_val = request.form.get(field)
                if field in ['panel_capacity', 'system_capacity', 'project_cost']:
                    try:
                        new_val_parsed = float(new_val) if new_val else 0.0
                        old_val_parsed = float(getattr(visit, field)) if getattr(visit, field) else 0.0
                        if old_val_parsed != new_val_parsed:
                            changes[field] = {"old": old_val_parsed, "new": new_val_parsed}
                            setattr(visit, field, new_val_parsed)
                    except:
                        pass
                else:
                    old_val = str(getattr(visit, field)) if getattr(visit, field) is not None else ""
                    if old_val != new_val:
                        changes[field] = {"old": old_val, "new": new_val}
                        setattr(visit, field, new_val)

        document_fields = [
            'quotation_file', 'agreement_file', 'aadhaar', 'pan', 
            'kseb_bill', 'bank_passbook', 'land_tax', 'building_tax', 'signature'
        ]
        
        for field in document_fields:
            if field in request.files:
                file_obj = request.files[field]
                if file_obj and file_obj.filename != '':
                    old_file_url = getattr(visit, field)
                    # public_id -> "{doctype}_{customer_id}" (Cloudinary appends the
                    # extension automatically), giving lavenir/{customer}_{id}/sitevisit/{doctype}_{id}.{ext}
                    public_id = f"{sanitize_path_segment(field)}_{sanitize_path_segment(customer.customer_id)}"
                    try:
                        upload_res = cloudinary.uploader.upload(
                            file_obj, folder=folder_path, public_id=public_id, overwrite=True
                        )
                    except Exception:
                        db.session.rollback()
                        return jsonify({"error": f"Failed to upload {field}. Please try again."}), 502
                    # Only delete the old file once the new one is confirmed
                    # uploaded, and only if one actually existed.
                    if old_file_url:
                        delete_cloudinary_file(old_file_url, folder_path)
                    changes[field] = {"old": old_file_url, "new": upload_res['secure_url']}
                    setattr(visit, field, upload_res['secure_url'])

        if 'images' in request.files:
            uploaded_photos = request.files.getlist('images')
            existing_photos_json = visit.images
            try:
                photo_urls_list = json.loads(existing_photos_json) if existing_photos_json else []
            except:
                photo_urls_list = []
                
            new_urls = []
            # Continue numbering from where the existing photo list left off so
            # each image gets a unique public_id within the same module folder.
            start_index = len(photo_urls_list) + 1
            for i, photo in enumerate(uploaded_photos):
                if photo and photo.filename != '':
                    public_id = f"photo{start_index + i}_{sanitize_path_segment(customer.customer_id)}"
                    try:
                        upload_res = cloudinary.uploader.upload(
                            photo, folder=folder_path, public_id=public_id, overwrite=True
                        )
                    except Exception:
                        db.session.rollback()
                        return jsonify({"error": "Failed to upload one of the images. Please try again."}), 502
                    new_urls.append(upload_res['secure_url'])
                    
            if new_urls:
                photo_urls_list.extend(new_urls)
                changes['images'] = {"added": new_urls}
                visit.images = json.dumps(photo_urls_list)
            
        if 'removed_images' in request.form:
            try:
                removed_list = json.loads(request.form.get('removed_images', '[]'))
                current_list = json.loads(visit.images) if visit.images else []
                updated_list = [img for img in current_list if img not in removed_list]
                if len(current_list) != len(updated_list):
                    changes['removed_images'] = {"removed": removed_list}
                    visit.images = json.dumps(updated_list)
                for img_url in removed_list:
                    delete_cloudinary_file(img_url, folder_path)
            except Exception as e:
                print(f"Image mutation filtering error: {str(e)}")

        visit.updated_by = current_user_id
        visit.updated_at = datetime.utcnow()
            
        if changes or action_type == "CREATE":
            audit_log = CustomerAuditLog(
                customer_project_id=customer.id,
                user_id=current_user_id,
                action=action_type,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {"initialized": True})
            )
            db.session.add(audit_log)
            
        visit.work_done = "Completed" if (
            (visit.panel_capacity or 0) > 0 and (visit.system_capacity or 0) > 0 and
            visit.feasibility == "Yes" and (visit.project_cost or 0) > 0 and
            visit.location and visit.quotation_file and visit.agreement_file and
            visit.aadhaar and visit.pan and visit.kseb_bill and visit.bank_passbook and
            visit.land_tax and visit.building_tax and visit.signature
        ) else "Pending"
        db.session.commit()
        return jsonify({"message": "Records synchronized successfully", "visit": visit.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Save failed: {str(e)}"}), 500