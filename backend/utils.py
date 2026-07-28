import json
import re
import cloudinary.uploader
from models import db, User, UserPermission, PermissionRequest
from flask import jsonify

def delete_cloudinary_file(file_url, folder_path):
    """
    Extracts the public_id from a Cloudinary URL and destroys the asset on Cloudinary storage.
    Returns True if successfully deleted, False otherwise.
    """
    if file_url and "res.cloudinary.com" in file_url:
        try:
            # Extract public asset identifier from the asset URL string
            public_id = file_url.split('/')[-1].split('.')[0]
            cloudinary.uploader.destroy(f"{folder_path}/{public_id}")
            return True
        except Exception as e:
            print(f"Cloudinary asset cleanup fault for {file_url}: {str(e)}")
    return False


def is_admin_user(user_id):
    """
    Returns True only if user_id resolves to an existing user with the 'admin' role.
    Centralized so every admin-only route checks the same way.
    """
    user = User.query.get(user_id)
    return bool(user and user.role and user.role.strip().lower() == 'admin')


def check_permission(user_id, permission_type, module_name):
    """
    Checks permissions strictly against the live UserPermission matrix — the single
    source of truth for what a staff member is currently allowed to do.

    NOTE: We intentionally do NOT fall back to checking for an 'Approved'
    PermissionRequest row here. process_permission_request() already writes
    approvals into permissions_matrix at approval time, so the matrix always
    reflects the latest state. A separate "any approved request ever" fallback
    would let access silently persist even after an admin unchecks it later in
    PermissionManagement.jsx, since revoking there only updates the matrix and
    has no way to also invalidate old PermissionRequest rows.
    """
    user = User.query.get(user_id)
    if not user:
        return False

    # Administrative role bypass barrier: Admins automatically possess full permissions
    if user.role and user.role.strip().lower() == 'admin':
        return True

    perm_record = UserPermission.query.filter_by(user_id=user_id).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            if module_name in matrix and matrix[module_name].get(permission_type) is True:
                return True
        except Exception:
            pass

    return False

def handle_blueprint_check_access(uid, module_name):
    """
    Centralized blueprint token clearance helper function for single module lookups.
    Updated to include persistent 'pending_requests' map across all project modules.
    """
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    # Fetch any active pending access requests for this user and module from the database
    pending_records = PermissionRequest.query.filter_by(
        user_id=uid,
        module_name=module_name,
        status='Pending'
    ).all()
    
    pending_requests_map = {req.permission_type: "Pending" for req in pending_records}

    if user.role and user.role.strip().lower() == 'admin':
        return jsonify({
            "view": True, 
            "create": True, 
            "update": True, 
            "delete": False,
            "pending_requests": pending_requests_map
        }), 200

    # Mapped 'create' check to the 'update' baseline tier configuration layout
    can_update = check_permission(uid, 'update', module_name)
    permissions = {
        "view": check_permission(uid, 'view', module_name),
        "create": can_update,
        "update": can_update,
        "delete": False,
        "pending_requests": pending_requests_map
    }
    return jsonify(permissions), 200



def handle_blueprint_request_access(uid, module_name, data):
    """
    Centralized administrative tier elevation builder logic to process access upgrade requests.
    """
    permission_type = data.get('permission_type', 'view')

    if permission_type not in ['view', 'create', 'update']:
        return jsonify({"error": "Invalid tier specified or tier is disabled."}), 400

    existing = PermissionRequest.query.filter_by(
        user_id=uid,
        module_name=module_name,
        permission_type=permission_type,
        status='Pending'
    ).first()

    if existing:
        return jsonify({"message": f"An access request for the '{permission_type}' tier is already pending review."}), 200

    db.session.add(PermissionRequest(
        user_id=uid,
        module_name=module_name,
        permission_type=permission_type,
        status='Pending'
    ))
    db.session.commit()
    return jsonify({"message": f"Access request for '{permission_type}' submitted successfully to the administrator."}), 201


def handle_get_all_permissions(uid):
    """
    Centralized endpoint logic to fetch the full authorization matrix for a user in a single call.
    Reduces network overhead by allowing the frontend React Global Context to store permissions locally.
    """
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "User context not found"}), 404

    # If the user is an administrator, return a full permission matrix for all operational workspaces
    if user.role and user.role.strip().lower() == 'admin':
        modules = [
            'Payment Flow', 'Service', 'Site Visit', 'DCR', 
            'Kseb', 'KSEB Registration & Completion', 'MNRE Profile', 
            'Bank Loan', 'MNRE Installation', 'Material Delivery', 'Material Installation'
        ]
        admin_matrix = {mod: {"view": True, "create": True, "update": True, "delete": False} for mod in modules}
        return jsonify({"permissions_matrix": admin_matrix}), 200

    # For standard staff accounts, retrieve the live permission registry from database records
    perm_record = UserPermission.query.filter_by(user_id=uid).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            return jsonify({"permissions_matrix": matrix}), 200
        except Exception:
            pass

    # Fallback default response: Empty dictionary if no matrix matches or mapping fails
    return jsonify({"permissions_matrix": {}}), 200


def sanitize_path_segment(value):
    """
    Strips characters that would break a Cloudinary folder/file path (spaces,
    slashes, and anything outside [A-Za-z0-9_-]). Used by every helper below
    so folder and file names built from user-entered data stay filesystem-safe.
    """
    if value is None:
        return ""
    value = str(value).strip().replace(' ', '_')
    return re.sub(r'[^a-zA-Z0-9_-]', '', value)


def get_customer_folder(customer_name, customer_id):
    """
    Builds the '{customer_name}_{customer_id}' folder segment used as the
    top-level directory for a customer under 'lavenir/'.
    """
    return f"{sanitize_path_segment(customer_name)}_{sanitize_path_segment(customer_id)}"


def get_module_folder_path(customer_name, customer_id, module_name):
    """
    Builds the folder path for a given customer + module, e.g.:
    lavenir/johndoe_1023/sitevisit
    """
    customer_folder = get_customer_folder(customer_name, customer_id)
    module_segment = sanitize_path_segment(module_name)
    return f"lavenir/{customer_folder}/{module_segment}"


def get_doc_filename(doctype, customer_id, ext):
    """
    Builds the stored document/image filename, e.g. 'adhar_1023.jpg'.
    """
    ext = str(ext).lstrip('.')
    return f"{sanitize_path_segment(doctype)}_{sanitize_path_segment(customer_id)}.{ext}"


def build_doc_path(customer_name, customer_id, module_name, doctype, ext):
    """
    Centralized document/image path builder — the single source of truth for
    where a customer document lives in Cloudinary storage.

    Returns:
        lavenir/{customer_name}_{customer_id}/{module_name}/{doctype}_{customer_id}.{ext}

    Example:
        build_doc_path("John Doe", 1023, "sitevisit", "adhar", "jpg")
        -> "lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg"
    """
    folder_path = get_module_folder_path(customer_name, customer_id, module_name)
    filename = get_doc_filename(doctype, customer_id, ext)
    return f"{folder_path}/{filename}"


# ==========================================
# NOTIFICATION-RULE HELPERS (added)
# ==========================================

def check_all_modules_complete(customer):
    """
    Returns True only if every one of the 10 workflow modules for this
    customer has work_done == 'Completed'.

    `customer` is a CustomerProject instance. Uses the one-to-one/one-to-many
    backrefs already defined on the model relationships — no extra queries
    needed beyond what SQLAlchemy lazy-loads.
    """
    def done(rel):
        if rel is None:
            return False
        val = getattr(rel, 'work_done', None)
        return bool(val) and val.strip().lower() == 'completed'

    latest_site_visit = customer.site_visits[-1] if customer.site_visits else None
    latest_kseb = customer.kseb_records[-1] if customer.kseb_records else None

    checks = [
        done(latest_site_visit),
        done(customer.mnre_profile_rel),
        done(customer.mnre_installation_rel),
        done(customer.bank_loan_rel),
        done(customer.payment_rel),
        done(latest_kseb),
        done(customer.kseb_registration_rel),
        done(customer.dcr_certificate_rel),
        done(customer.material_delivery_rel),
        done(customer.material_installation_rel),
    ]
    return all(checks)


def get_all_admin_ids():
    """Returns the id list of every user with role == 'admin'."""
    return [u.id for u in User.query.filter_by(role='admin').all()]