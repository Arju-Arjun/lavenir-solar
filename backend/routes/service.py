from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, Service, User, PermissionRequest, CustomerProject, CustomerAuditLog
from datetime import datetime
from functools import wraps
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

service_bp = Blueprint('service_bp', __name__)

# Standard core matrix validation key mapped strictly to target specification modules
MODULE_NAME = 'Service'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'service'


def resequence_service_numbers(customer_project_id):
    services = Service.query.filter_by(customer_project_id=customer_project_id).order_by(
        Service.created_at.asc(),
        Service.id.asc()
    ).all()

    for index, service in enumerate(services, start=1):
        if service.service_number != index:
            service.service_number = index

    customer = CustomerProject.query.get(customer_project_id)
    if customer:
        customer.last_service_number = len(services)

    return services


def handle_errors(f):
    """Ensures any unhandled exception returns a proper JSON 500 response
    that still passes through flask-cors, instead of an unhandled exception
    hitting the Werkzeug debugger directly (which skips CORS headers and
    shows up in the browser as a CORS error / net::ERR_FAILED)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            db.session.rollback()
            print(f"!!! CRITICAL EXCEPTION IN {request.path} -> {str(e)}")
            return jsonify({"error": "Internal Server Error", "details": str(e)}), 500
    return wrapper


# ==========================================
# ACCESS LAYER
# ==========================================
@service_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_module_access():
    uid = int(get_jwt_identity())
    
    # Process base permission checks via centralized validation helpers
    response, status_code = handle_blueprint_check_access(uid, MODULE_NAME)
    access_data = response.get_json()
    
    # Query database for open pending authorization tokens matching this user session
    pending_records = PermissionRequest.query.filter_by(
        user_id=uid,
        module_name=MODULE_NAME,
        status='Pending'
    ).all()
    
    # Format database rows into tracking dictionaries to retain status text displays on reload
    pending_requests_map = {}
    for req in pending_records:
        pending_requests_map[req.permission_type] = "Access request pending approval."
        
    access_data['pending_requests'] = pending_requests_map
    return jsonify(access_data), status_code


@service_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = int(get_jwt_identity())
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


# ==========================================
# READ SERVICES
# ==========================================
@service_bp.route('/project/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_services(customer_id):
    try:
        current_user_id = int(get_jwt_identity())
        user = User.query.get(current_user_id)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'

        if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
            return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403
            
        customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not customer:
            return jsonify({"services": [], "message": "Customer matching identity not found."}), 404

        sort_by = request.args.get('sort_by', 'created_desc')
        sort_options = {
            'created_desc': Service.created_at.desc(),
            'created_asc': Service.created_at.asc(),
            'updated_desc': Service.updated_at.desc(),
            'updated_asc': Service.updated_at.asc(),
        }
        order_clause = sort_options.get(sort_by, Service.created_at.desc())

        services = Service.query.filter_by(customer_project_id=customer.id).order_by(order_clause).all()
        return jsonify({"services": [s.to_dict() for s in services]}), 200
        
    except Exception as e:
        print(f"!!! CRITICAL EXCEPTION IN /api/service/project/{customer_id}/ -> {str(e)}")
        return jsonify({
            "error": "Internal Server Error during serialization layer", 
            "details": str(e)
        }), 500


@service_bp.route('/<int:service_id>/', methods=['GET'])
@jwt_required()
def get_service_by_id(service_id):
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
        return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403
        
    service = Service.query.get(service_id)
    if not service:
        return jsonify({"error": "Service log record not found."}), 404
        
    return jsonify({"service": service.to_dict()}), 200


# ==========================================
# CREATE / UPDATE SERVICE
# ==========================================
@service_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
@handle_errors
def create_service(customer_id):
        current_user_id = int(get_jwt_identity())
        user = User.query.get(current_user_id)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'

        if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
            return jsonify({"error": "Permission Denied to create records."}), 403

        customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not customer:
            return jsonify({"message": "Customer record could not be resolved."}), 404

        # Centralized storage folder for this customer + module, e.g.:
        # lavenir/JohnDoe_1023/service
        folder_path = get_module_folder_path(customer.customer_name, customer.customer_id, FOLDER_MODULE_NAME)

        service_date_raw = request.form.get('service_date')
        service_type = request.form.get('service_type')

        if not service_date_raw or not service_type:
            return jsonify({"error": "Service date and service type are mandatory fields."}), 400

        try:
            service_date = datetime.fromisoformat(service_date_raw)
        except ValueError:
            try:
                service_date = datetime.strptime(service_date_raw, "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": "Invalid date format for service_date."}), 400

        next_service_due = None
        next_due_raw = request.form.get('next_service_due')
        if next_due_raw:
            try:
                next_service_due = datetime.fromisoformat(next_due_raw)
            except ValueError:
                try:
                    next_service_due = datetime.strptime(next_due_raw, "%Y-%m-%d")
                except ValueError:
                    pass

        technician_name = request.form.get('technician_name')
        complaint_issue = request.form.get('complaint_issue')
        system_status = request.form.get('system_status')
        comments = request.form.get('comments')

        parts_replaced_raw = request.form.get('parts_replaced', '[]')
        try:
            json.loads(parts_replaced_raw)
            parts_replaced = parts_replaced_raw
        except ValueError:
            parts_replaced = '[]'

        photo_urls_list = []
        if 'images' in request.files:
            uploaded_photos = request.files.getlist('images')
            for i, photo in enumerate(uploaded_photos):
                if photo and photo.filename != '':
                    try:
                        public_id = f"photo{i + 1}_{sanitize_path_segment(customer.customer_id)}"
                        upload_res = cloudinary.uploader.upload(
                            photo, folder=folder_path, public_id=public_id, overwrite=True
                        )
                        photo_urls_list.append(upload_res['secure_url'])
                    except Exception as ce:
                        print(f"Cloudinary upload failed: {str(ce)}")

        new_service = Service(
            customer_project_id=customer.id,
            service_number=0,
            service_date=service_date,
            service_type=service_type,
            technician_name=technician_name,
            complaint_issue=complaint_issue,
            system_status=system_status,
            parts_replaced=parts_replaced,
            next_service_due=next_service_due,
            comments=comments,
            images=json.dumps(photo_urls_list),
            created_by=current_user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.session.add(new_service)
        resequence_service_numbers(customer.id)

        audit_log = CustomerAuditLog(
            customer_project_id=customer.id,
            user_id=current_user_id,
            action="CREATE",
            module_name=MODULE_NAME,
            changes_payload=json.dumps({"initialized": True})
        )
        db.session.add(audit_log)
        db.session.commit()

        # ---- Notification hooks ----
        # Imported here (not at module top) to avoid a circular import, since
        # notification_rules.py itself may import helpers that touch other
        # route modules.
        from routes.notification_rules import notify_admins

        if service_type and service_type.strip().lower() in ('maintenance', 'maintain'):
            customer.maintenance_count = (customer.maintenance_count or 0) + 1
            customer.last_maintenance_added_date = datetime.utcnow()
            db.session.commit()

        notify_admins(
            customer,
            title="Service Completed",
            body=f"A service log was added for {customer.customer_name}.",
            notif_type="service_complete"
        )

        return jsonify({"message": "Service log generated successfully", "service": new_service.to_dict()}), 201


@service_bp.route('/update/<int:service_id>/', methods=['POST'])
@jwt_required()
@handle_errors
def update_service(service_id):
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
        return jsonify({"error": "Permission Denied to modify records."}), 403

    service = Service.query.get(service_id)
    if not service:
        return jsonify({"message": "Service log context matching identity not found."}), 404

    customer = CustomerProject.query.get(service.customer_project_id)
    if not customer:
        return jsonify({"message": "Customer record could not be resolved."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/service
    folder_path = get_module_folder_path(customer.customer_name, customer.customer_id, FOLDER_MODULE_NAME)

    changes = {}
    
    text_fields = ['service_type', 'technician_name', 'complaint_issue', 'system_status', 'comments']
    for field in text_fields:
        if field in request.form:
            new_val = request.form.get(field)
            old_val = getattr(service, field)
            if old_val != new_val:
                changes[field] = {"old": old_val, "new": new_val}
                setattr(service, field, new_val)

    date_fields = ['service_date', 'next_service_due']
    for field in date_fields:
        if field in request.form:
            raw_date = request.form.get(field)
            old_date_obj = getattr(service, field)
            old_str = old_date_obj.strftime("%Y-%m-%d") if old_date_obj else None
            
            new_date_obj = None
            new_str = None
            if raw_date:
                try:
                    new_date_obj = datetime.fromisoformat(raw_date)
                    new_str = new_date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    try:
                        new_date_obj = datetime.strptime(raw_date, "%Y-%m-%d")
                        new_str = new_date_obj.strftime("%Y-%m-%d")
                    except ValueError:
                        continue
            
            if old_str != new_str:
                changes[field] = {"old": old_str, "new": new_str}
                setattr(service, field, new_date_obj)

    if 'parts_replaced' in request.form:
        new_parts_raw = request.form.get('parts_replaced', '[]')
        try:
            new_parts_parsed = json.loads(new_parts_raw)
            old_parts_parsed = json.loads(service.parts_replaced) if service.parts_replaced else []
            if old_parts_parsed != new_parts_parsed:
                changes['parts_replaced'] = {"old": old_parts_parsed, "new": new_parts_parsed}
                service.parts_replaced = new_parts_raw
        except ValueError:
            pass

    try:
        photo_urls_list = json.loads(service.images) if service.images else []
    except ValueError:
        photo_urls_list = []

    if 'images' in request.files:
        uploaded_photos = request.files.getlist('images')
        new_urls = []
        # Continue numbering from where the existing photo list left off so
        # each image gets a unique public_id within the same module folder.
        start_index = len(photo_urls_list) + 1
        for i, photo in enumerate(uploaded_photos):
            if photo and photo.filename != '':
                try:
                    public_id = f"photo{start_index + i}_{sanitize_path_segment(customer.customer_id)}"
                    upload_res = cloudinary.uploader.upload(
                        photo, folder=folder_path, public_id=public_id, overwrite=True
                    )
                    new_urls.append(upload_res['secure_url'])
                except Exception as ce:
                    print(f"Cloudinary append step error: {str(ce)}")
        if new_urls:
            photo_urls_list.extend(new_urls)
            changes['images'] = {"added": new_urls}
            service.images = json.dumps(photo_urls_list)

    if 'removed_images' in request.form:
        try:
            removed_list = json.loads(request.form.get('removed_images', '[]'))
            updated_list = [img for img in photo_urls_list if img not in removed_list]
            if len(photo_urls_list) != len(updated_list):
                changes['removed_images'] = {"removed": removed_list}
                service.images = json.dumps(updated_list)
            
            for img_url in removed_list:
                try:
                    delete_cloudinary_file(img_url, folder_path)
                except Exception as inner_e:
                    print(f"Isolated asset drop breakdown: {str(inner_e)}")
        except Exception as e:
            print(f"Image filtering operation encountered failure: {str(e)}")

    if changes:
        service.updated_by = current_user_id
        service.updated_at = datetime.utcnow()
        
        audit_log = CustomerAuditLog(
            customer_project_id=service.customer_project_id,
            user_id=current_user_id,
            action="UPDATE",
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes)
        )
        db.session.add(audit_log)
        db.session.commit()
    else:
        db.session.commit()

    return jsonify({"message": "Service records updated successfully", "service": service.to_dict()}), 200


# ==========================================
# DELETE SERVICE
# ==========================================
@service_bp.route('/<int:service_id>/', methods=['DELETE'])
@jwt_required()
@handle_errors
def delete_service(service_id):
    current_user_id = int(get_jwt_identity())
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'delete', MODULE_NAME):
        return jsonify({"error": "Permission Denied to perform destructive actions."}), 403
        
    service = Service.query.get(service_id)
    if not service:
        return jsonify({"message": "No service metadata found matching target configuration key."}), 404

    customer = CustomerProject.query.get(service.customer_project_id)
    # Centralized storage folder for this customer + module (used to resolve
    # public_ids for deletion). Falls back gracefully if the customer record
    # is somehow missing so cleanup failure never blocks the delete itself.
    folder_path = (
        get_module_folder_path(customer.customer_name, customer.customer_id, FOLDER_MODULE_NAME)
        if customer else None
    )

    if service.images and folder_path:
        try:
            image_urls = json.loads(service.images)
            for url in image_urls:
                try:
                    delete_cloudinary_file(url, folder_path)
                except Exception as inner_e:
                    print(f"Isolated deletion asset cleanup skip: {str(inner_e)}")
        except Exception as e:
            print(f"Asset cleanup layer fault: {str(e)}")

    audit_log = CustomerAuditLog(
        customer_project_id=service.customer_project_id,
        user_id=current_user_id,
        action="DELETE",
        module_name=MODULE_NAME,
        changes_payload=json.dumps({"purged": True})
    )
    db.session.add(audit_log)
    
    db.session.delete(service)
    resequence_service_numbers(service.customer_project_id)
    db.session.commit()
    return jsonify({"message": "Service record expunged successfully from database."}), 200