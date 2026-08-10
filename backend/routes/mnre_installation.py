from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, CustomerProject, MNREProfile, MNREInstallation, CustomerAuditLog, PermissionRequest
from utils import (
    check_permission,
    handle_blueprint_check_access,
    handle_blueprint_request_access
)
from datetime import datetime
import json

mnre_installation_bp = Blueprint('mnre_installation_bp', __name__)

# Standard core matrix validation key mapped strictly to target specification rows
MODULE_NAME = 'MNRE Installation'


class InvalidDateError(Exception):
    def __init__(self, field):
        self.field = field


def _parse_date(field, date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        raise InvalidDateError(field)


@mnre_installation_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    # Automatically pulls view/update permissions and active pending requests via centralized utils
    return handle_blueprint_check_access(uid, MODULE_NAME)


@mnre_installation_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@mnre_installation_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_mnre_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(uid, 'view', MODULE_NAME):
        return jsonify({"error": "Unauthorized View clearance matrix level missing."}), 403

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"installation": None, "message": "Customer project record could not be resolved."}), 404

    mnre_profile = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
    mnre_status = mnre_profile.mnre_status if (mnre_profile and mnre_profile.mnre_status) else "Pending"

    installation = MNREInstallation.query.filter_by(customer_project_id=cust.id).first()

    return jsonify({
        "installation": installation.to_dict() if installation else None,
        "mnre_profile_status": mnre_status
    }), 200


@mnre_installation_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_mnre_installation(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"error": "Customer project record could not be resolved."}), 404

    installation = MNREInstallation.query.filter_by(customer_project_id=cust.id).first()
    action = "UPDATE" if installation else "CREATE"

    # Permission check runs ahead of the MNRE-profile-status check so a
    # user with no update permission on MNRE Installation never learns
    # the customer's MNRE Profile completion status before being told
    # they lack access — permission gates everything else, not the
    # other way around.
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
        return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

    mnre_profile = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
    if not mnre_profile or mnre_profile.mnre_status != 'Completed':
        return jsonify({"error": "Modifications blocked: MNRE Profile status must be marked as 'Completed'."}), 403

    if not installation:
        installation = MNREInstallation(customer_project_id=cust.id, created_by=uid)
        db.session.add(installation)

    data_source = request.get_json(silent=True) or request.form
    changes = {}

    try:
        if 'installation_status' in data_source:
            old_val = installation.installation_status
            new_val = data_source.get('installation_status')
            installation.installation_status = new_val
            if old_val != new_val:
                changes['installation_status'] = {"old": old_val, "new": new_val}

        if 'installation_date' in data_source:
            old_val = installation.installation_date
            new_date = _parse_date('installation_date', data_source.get('installation_date'))
            installation.installation_date = new_date
            if old_val != installation.installation_date:
                changes['installation_date'] = {"old": str(old_val), "new": str(installation.installation_date)}

        if 'approval_status' in data_source:
            old_val = installation.approval_status
            new_val = data_source.get('approval_status')
            installation.approval_status = new_val
            if old_val != new_val:
                changes['approval_status'] = {"old": old_val, "new": new_val}

        if 'approval_date' in data_source:
            old_val = installation.approval_date
            new_date = _parse_date('approval_date', data_source.get('approval_date'))
            installation.approval_date = new_date
            if old_val != installation.approval_date:
                changes['approval_date'] = {"old": str(old_val), "new": str(installation.approval_date)}

        if 'subsidy_status' in data_source:
            old_val = installation.subsidy_status
            new_val = data_source.get('subsidy_status')
            installation.subsidy_status = new_val
            if old_val != new_val:
                changes['subsidy_status'] = {"old": old_val, "new": new_val}

        if 'subsidy_amount' in data_source:
            old_val = float(installation.subsidy_amount or 0.0)
            raw_amt = data_source.get('subsidy_amount')
            try:
                new_val = float(raw_amt) if raw_amt not in (None, '') else 0.0
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid subsidy_amount value."}), 400
            if new_val < 0:
                return jsonify({"error": "subsidy_amount cannot be negative."}), 400
            installation.subsidy_amount = new_val
            if old_val != new_val:
                changes['subsidy_amount'] = {"old": old_val, "new": new_val}

        if 'subsidy_received_date' in data_source:
            old_val = installation.subsidy_received_date
            new_date = _parse_date('subsidy_received_date', data_source.get('subsidy_received_date'))
            installation.subsidy_received_date = new_date
            if old_val != installation.subsidy_received_date:
                changes['subsidy_received_date'] = {"old": str(old_val), "new": str(installation.subsidy_received_date)}

        if 'comments' in data_source:
            old_val = installation.comments
            new_val = data_source.get('comments')
            installation.comments = new_val
            if old_val != new_val:
                changes['comments'] = {"old": old_val, "new": new_val}
    except InvalidDateError as e:
        return jsonify({"error": f"Invalid {e.field}. Expected format YYYY-MM-DD."}), 400

    installation.updated_by = uid
    installation.updated_at = datetime.utcnow()
    old_work_done = installation.work_done
    installation.work_done = "Completed" if (
        installation.installation_status == 'Completed' and 
        installation.approval_status == 'Approved' and 
        installation.subsidy_status == 'Received'
    ) else "Pending"
    if old_work_done != installation.work_done:
        changes['work_done'] = {"old": old_work_done, "new": installation.work_done}

    try:
        if changes or action == "CREATE":
            db.session.add(CustomerAuditLog(
                customer_project_id=cust.id,
                user_id=uid,
                action=action,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {'initialized': True})
            ))
        db.session.commit()
        return jsonify({"message": "MNRE Installation record synchronized successfully", "installation": installation.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Database error occurred", "details": str(e)}), 500