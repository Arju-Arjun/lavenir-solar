from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, SiteVisit, PermissionRequest, CustomerProject, CustomerAuditLog, KSEB
from datetime import datetime
import json
from utils import (
    check_permission, 
    handle_blueprint_check_access, 
    handle_blueprint_request_access
)

kseb_bp = Blueprint('kseb_bp', __name__)

# System core matrix validation key mapped strictly to target specification modules
MODULE_NAME = 'KSEB Feasibility'


@kseb_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_module_access():
    uid = get_jwt_identity()
    # Automatically pulls view/update permissions and active pending requests via utils.py (matching MNRE model)
    return handle_blueprint_check_access(uid, MODULE_NAME)


@kseb_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@kseb_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_kseb(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(current_user_id, 'view', MODULE_NAME):
        return jsonify({"error": "Permission Denied", "code": "NO_VIEW_ACCESS"}), 403

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"kseb": None, "message": "Customer project record not found."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()
    site_visit_flags = {
        "ownership_change": site_visit.ownership_change if site_visit else "No",
        "load_enhancement": site_visit.load_enhancement if site_visit else "No"
    }

    kseb_record = KSEB.query.filter_by(customer_project_id=cust.id).first()
    return jsonify({
        "kseb": kseb_record.to_dict() if kseb_record else None,
        "site_visit_flags": site_visit_flags
    }), 200


@kseb_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_kseb(customer_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"message": "Customer project record not found."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()
    kseb_data = KSEB.query.filter_by(customer_project_id=cust.id).first()
    action_type = "UPDATE" if kseb_data else "CREATE"

    if not is_admin and not check_permission(current_user_id, 'update', MODULE_NAME):
        return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

    if not kseb_data:
        kseb_data = KSEB(customer_project_id=cust.id, created_by=current_user_id)
        db.session.add(kseb_data)

    data = request.get_json() or {}
    changes = {}

    # Feasibility can only be marked Complete once the fee has been paid.
    # Resolve the effective values (incoming payload wins over the stored
    # value) so this check works whether fee_paid/feasibility_status are
    # being changed together or independently in this request.
    effective_fee_paid = data.get('fee_paid', kseb_data.fee_paid)
    effective_feasibility_status = data.get('feasibility_status', kseb_data.feasibility_status)
    if effective_feasibility_status == 'Complete' and not effective_fee_paid:
        return jsonify({"error": "Feasibility status can only be marked Complete after the fee has been paid."}), 400

    for field in ['ownership_status', 'ownership_comment', 'load_enhancement_status', 'load_enhancement_comment', 'feasibility_status','comments', 'fee_paid']:
        if field in data:
            old_val = getattr(kseb_data, field)
            new_val = data[field]
            if old_val != new_val:
                changes[field] = {"old": old_val, "new": new_val}
                setattr(kseb_data, field, new_val)
    
    # Workflow validation engine verification rules
    kseb_data.work_done = "Completed" if (
        ((site_visit and site_visit.ownership_change == 'Yes' and kseb_data.ownership_status == 'Complete') or not site_visit or site_visit.ownership_change != 'Yes') and 
        ((site_visit and site_visit.load_enhancement == 'Yes' and kseb_data.load_enhancement_status == 'Complete') or not site_visit or site_visit.load_enhancement != 'Yes') and 
        (kseb_data.fee_paid and kseb_data.feasibility_status == 'Complete')
    ) else "Pending"

    if changes or action_type == "CREATE":
        log = CustomerAuditLog(
            customer_project_id=cust.id,
            user_id=current_user_id,
            action=action_type,
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes if changes else {"initialized": True})
        )
        db.session.add(log)

    kseb_data.updated_by = current_user_id
    kseb_data.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({"message": "KSEB record synchronized successfully", "kseb": kseb_data.to_dict()}), 200