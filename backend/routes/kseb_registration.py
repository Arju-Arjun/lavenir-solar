from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, PermissionRequest, CustomerProject, CustomerAuditLog, KsebRegistrationCompletion, SiteVisit
from datetime import datetime
import json
from utils import (
    check_permission, 
    handle_blueprint_check_access, 
    handle_blueprint_request_access
)

kseb_reg_bp = Blueprint('kseb_reg_bp', __name__)

MODULE_NAME = 'KSEB Registration & Completion'


@kseb_reg_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_module_access():
    uid = get_jwt_identity()
    # Automatically pulls base permissions and pending request map using centralized utils
    return handle_blueprint_check_access(uid, MODULE_NAME)


@kseb_reg_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@kseb_reg_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_kseb_registration(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
        return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"registration": None, "message": "Customer project record not found."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
    wifi_required = site_visit.wifi if (site_visit and site_visit.wifi is not None) else "No"

    reg = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer.id).first()
    return jsonify({
        "registration": reg.to_dict() if reg else None,
        "wifi_required": wifi_required
    }), 200


@kseb_reg_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_kseb_registration(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"message": "Customer record could not be resolved."}), 404

    reg = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer.id).first()
    action = 'UPDATE' if reg else 'CREATE'

    if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
        return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

    if not reg:
        reg = KsebRegistrationCompletion(customer_project_id=customer.id, created_by=current_user_id)
        db.session.add(reg)

    visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
    changes = {}

    bool_fields = [
        'registration_submitted', 'completion_submitted', 
        'agreement_submitted', 'payment_done', 
        'plant_energized', 'wifi_configured'
    ]
    date_fields = [
        'registration_date', 'completion_date', 
        'agreement_date', 'payment_date', 
        'plant_energized_date', 'wifi_configured_date'
    ]

    for field in bool_fields:
        if field in request.form:
            raw_val = request.form.get(field)
            parsed_bool = True if str(raw_val).lower() in ['true', '1', 'yes', 'on'] else False
            old_val = getattr(reg, field)
            if old_val != parsed_bool:
                changes[field] = {"old": old_val, "new": parsed_bool}
                setattr(reg, field, parsed_bool)

    for field in date_fields:
        if field in request.form:
            date_str = request.form.get(field)
            parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else None
            old_val = getattr(reg, field)
            if old_val != parsed_date:
                changes[field] = {"old": str(old_val), "new": str(parsed_date)}
                setattr(reg, field, parsed_date)

    if 'comments' in request.form:
        old_val = reg.comments
        new_val = request.form.get('comments')
        if old_val != new_val:
            changes['comments'] = {"old": old_val, "new": new_val}
            reg.comments = new_val

    reg.updated_by = current_user_id
    reg.updated_at = datetime.utcnow()

    if changes or action == 'CREATE':
        db.session.add(CustomerAuditLog(
            customer_project_id=customer.id,
            user_id=current_user_id,
            action=action,
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes if changes else {'initialized': True})
        ))

    # Wifi should only gate completion when this customer's site visit actually
    # requires it. If it's not required, it's vacuously satisfied; if it is
    # required, it must actually be configured (not just "required").
    wifi_required_for_customer = bool(
        visit and (visit.wifi == True or str(visit.wifi).strip().lower() == 'yes')
    )
    wifi_status_check = (not wifi_required_for_customer) or bool(reg.wifi_configured)

    reg.work_done = "Completed" if (
        reg.registration_submitted == True and 
        reg.completion_submitted == True and 
        reg.agreement_submitted == True and 
        reg.payment_done == True and 
        reg.plant_energized == True and 
        wifi_status_check
    ) else "Pending"
    
    db.session.commit()
    return jsonify({"message": "KSEB Registration & Completion updated successfully", "registration": reg.to_dict()}), 200