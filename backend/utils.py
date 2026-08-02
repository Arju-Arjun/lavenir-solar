import json
import re
import os
import requests
import cloudinary.uploader
from models import db, User, UserPermission, PermissionRequest, SiteVisit, KSEB
from flask import jsonify


def send_reset_email(to_email, reset_link):
    """
    Sends the password-reset email via the Brevo transactional email HTTP
    API instead of raw SMTP. Render blocks outbound SMTP ports (25/465/587)
    on its free tier, which caused smtplib.SMTP() to hang indefinitely and
    eventually get the gunicorn worker SIGKILLed on WORKER TIMEOUT. This is
    a plain HTTPS call (port 443), so it isn't affected by that block, and
    the explicit timeout means a failure raises a normal exception quickly
    instead of hanging the worker.

    MAIL_FROM must be a sender address verified in the Brevo dashboard
    (Senders, Domains & Dedicated IPs -> Senders -> Add a sender) - it does
    not require owning/verifying a full domain.
    """
    api_key = os.getenv('BREVO_API_KEY')
    from_email = os.getenv('MAIL_FROM')

    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={
            "sender": {"email": from_email, "name": "Lavenir Solar"},
            "to": [{"email": to_email}],
            "subject": "Password Reset Request - Lavenir Solar",
            "textContent": (
                f"Hello,\n\nWe received a request to reset your password.\n\n"
                f"Click the link below to set a new password (valid for 15 minutes):\n{reset_link}\n\n"
                f"If you didn't request this, you can safely ignore this email."
            ),
        },
        timeout=10,
    )
    response.raise_for_status()


def delete_cloudinary_file(file_url, folder_path):
    if file_url and "res.cloudinary.com" in file_url:
        try:
            public_id = file_url.split('/')[-1].split('.')[0]
            cloudinary.uploader.destroy(f"{folder_path}/{public_id}")
            return True
        except Exception as e:
            print(f"Cloudinary asset cleanup fault for {file_url}: {str(e)}")
    return False


def is_admin_user(user_id):
    user = User.query.get(user_id)
    return bool(user and user.role and user.role.strip().lower() == 'admin')


def _permission_matrix_allows(user, permission_type, module_name):
    """Pure in-memory check against an already-loaded User — no query."""
    if user.role and user.role.strip().lower() == 'admin':
        return True
    perm_record = UserPermission.query.filter_by(user_id=user.id).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            return matrix.get(module_name, {}).get(permission_type) is True
        except Exception:
            return False
    return False


def permission_allows_for_user(user, permission_type, module_name):
    """
    Same in-memory check as check_permission(), but takes an already-loaded
    User object. Use this instead of check_permission() whenever the caller
    has already done User.query.get(uid) - avoids a redundant duplicate
    user fetch on every permission check.
    """
    return _permission_matrix_allows(user, permission_type, module_name)


def check_permission(user_id, permission_type, module_name):
    """
    Checks strictly against the live UserPermission matrix (single source of
    truth). No fallback to "any approved request ever" - process_permission_request()
    already writes approvals into the matrix at approval time, and a fallback
    would let access silently persist after an admin revokes it later.
    """
    user = User.query.get(user_id)
    if not user:
        return False
    return _permission_matrix_allows(user, permission_type, module_name)


def handle_blueprint_check_access(uid, module_name):
    """Centralized permission lookup for a single module (view/create/update/delete)."""
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    pending_records = PermissionRequest.query.filter_by(
        user_id=uid, module_name=module_name, status='Pending'
    ).all()
    pending_requests_map = {req.permission_type: "Pending" for req in pending_records}

    if user.role and user.role.strip().lower() == 'admin':
        return jsonify({
            "view": True, "create": True, "update": True, "delete": False,
            "pending_requests": pending_requests_map,
        }), 200

    # 'create' is mapped to the same 'update' tier
    can_update = _permission_matrix_allows(user, 'update', module_name)
    permissions = {
        "view": _permission_matrix_allows(user, 'view', module_name),
        "create": can_update,
        "update": can_update,
        "delete": False,
        "pending_requests": pending_requests_map,
    }
    return jsonify(permissions), 200


def handle_blueprint_request_access(uid, module_name, data):
    permission_type = data.get('permission_type', 'view')
    if permission_type not in ['view', 'create', 'update']:
        return jsonify({"error": "Invalid tier specified or tier is disabled."}), 400

    existing = PermissionRequest.query.filter_by(
        user_id=uid, module_name=module_name,
        permission_type=permission_type, status='Pending'
    ).first()
    if existing:
        return jsonify({"message": f"An access request for the '{permission_type}' tier is already pending review."}), 200

    db.session.add(PermissionRequest(
        user_id=uid, module_name=module_name,
        permission_type=permission_type, status='Pending'
    ))
    db.session.commit()
    return jsonify({"message": f"Access request for '{permission_type}' submitted successfully to the administrator."}), 201


def handle_get_all_permissions(uid):
    """Full permission matrix for a user in one call, so the frontend can cache it."""
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "User context not found"}), 404

    if user.role and user.role.strip().lower() == 'admin':
        modules = [
            'Payment Flow', 'Service', 'Site Visit', 'DCR',
            'Kseb', 'KSEB Registration & Completion', 'MNRE Profile',
            'Bank Loan', 'MNRE Installation', 'Material Delivery',
            'Material Installation', 'Complaints',
        ]
        admin_matrix = {mod: {"view": True, "create": True, "update": True, "delete": False} for mod in modules}
        return jsonify({"permissions_matrix": admin_matrix}), 200

    perm_record = UserPermission.query.filter_by(user_id=uid).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            return jsonify({"permissions_matrix": matrix}), 200
        except Exception:
            pass

    return jsonify({"permissions_matrix": {}}), 200


def sanitize_path_segment(value):
    """Strips anything outside [A-Za-z0-9_-] so Cloudinary folder/file paths stay safe."""
    if value is None:
        return ""
    value = str(value).strip().replace(' ', '_')
    return re.sub(r'[^a-zA-Z0-9_-]', '', value)


def get_customer_folder(customer_name, customer_id):
    return f"{sanitize_path_segment(customer_name)}_{sanitize_path_segment(customer_id)}"


def get_module_folder_path(customer_name, customer_id, module_name):
    customer_folder = get_customer_folder(customer_name, customer_id)
    module_segment = sanitize_path_segment(module_name)
    return f"lavenir/{customer_folder}/{module_segment}"


def get_doc_filename(doctype, customer_id, ext):
    ext = str(ext).lstrip('.')
    return f"{sanitize_path_segment(doctype)}_{sanitize_path_segment(customer_id)}.{ext}"


def build_doc_path(customer_name, customer_id, module_name, doctype, ext):
    """
    lavenir/{customer_name}_{customer_id}/{module_name}/{doctype}_{customer_id}.{ext}
    e.g. build_doc_path("John Doe", 1023, "sitevisit", "adhar", "jpg")
         -> "lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg"
    """
    folder_path = get_module_folder_path(customer_name, customer_id, module_name)
    filename = get_doc_filename(doctype, customer_id, ext)
    return f"{folder_path}/{filename}"


def check_all_modules_complete(customer):
    """
    True only if all 10 workflow modules for this customer have
    work_done == 'Completed'. site_visits/kseb_records are queried
    explicitly ordered by created_at - the backref list order is not
    guaranteed by SQLAlchemy.
    """
    def done(rel):
        if rel is None:
            return False
        val = getattr(rel, 'work_done', None)
        return bool(val) and val.strip().lower() == 'completed'

    latest_site_visit = (
        SiteVisit.query.filter_by(customer_project_id=customer.id)
        .order_by(SiteVisit.created_at.desc()).first()
    )
    latest_kseb = (
        KSEB.query.filter_by(customer_project_id=customer.id)
        .order_by(KSEB.created_at.desc()).first()
    )

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
    return [u.id for u in User.query.filter_by(role='admin').all()]


def get_users_with_permission(module_name, permission_type='view'):
    return get_users_with_permission_multi([module_name], permission_type)


def get_users_with_permission_multi(module_names, permission_type='update'):
    """
    2 queries total regardless of user/module count: admins are fetched
    directly, every non-admin's permissions_matrix is fetched once and
    checked in memory against all module_names. Avoids the old N+1 pattern
    of calling check_permission() per user per module.
    """
    admin_ids = [u.id for u in User.query.filter_by(role='admin').all()]

    target_ids = list(admin_ids)
    non_admin_perms = (
        UserPermission.query
        .join(User, UserPermission.user_id == User.id)
        .filter(db.or_(User.role.is_(None), User.role != 'admin'))
        .all()
    )
    for perm in non_admin_perms:
        if not perm.permissions_matrix:
            continue
        try:
            matrix = json.loads(perm.permissions_matrix)
        except Exception:
            continue
        if any(matrix.get(mod, {}).get(permission_type) is True for mod in module_names):
            target_ids.append(perm.user_id)

    return target_ids