from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, CustomerProject, MNREProfile, CustomerAuditLog, SiteVisit, PermissionRequest
from sqlalchemy.exc import IntegrityError
from utils import (
    check_permission, 
    delete_r2_file, 
    upload_to_r2,
    handle_blueprint_check_access, 
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment
)
from datetime import datetime
import json

mnre_bp = Blueprint('mnre_bp', __name__)

# Standard Matrix Key Name matching the frontend mapping engine grid
MODULE_NAME = 'MNRE Profile'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'mnre'

@mnre_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    # Automatically pulls view/update permissions and active pending requests via utils.py
    return handle_blueprint_check_access(uid, MODULE_NAME)


@mnre_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@mnre_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_mnre_profile(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    if not is_admin and not check_permission(uid, 'view', MODULE_NAME):
        return jsonify({"error": "Unauthorized View clearance matrix level missing."}), 403
        
    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"profile": None, "message": "Customer project record could not be resolved."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()
    site_feasibility = site_visit.feasibility if (site_visit and site_visit.feasibility) else "Yes"

    profile = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
    
    return jsonify({
        "profile": profile.to_dict() if profile else None,
        "site_feasibility": site_feasibility
    }), 200


@mnre_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_mnre_profile(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"error": "Customer project record could not be resolved."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/mnre
    folder_path = get_module_folder_path(cust.customer_name, cust.customer_id, FOLDER_MODULE_NAME)

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()

    profile = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
    action = "UPDATE" if profile else "CREATE"

    # Permission check runs ahead of the feasibility-block check so a user
    # with no update permission on MNRE Profile never learns the
    # customer's site-visit feasibility status before being told they
    # lack access — permission gates everything else, not the other way
    # around.
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
        return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

    if site_visit and site_visit.feasibility == "No":
        return jsonify({"error": "Modifications blocked: Structural baseline feasibility is marked as 'No'."}), 403

    try:
        if not profile:
            profile = MNREProfile(customer_project_id=cust.id, created_by=uid)
            db.session.add(profile)
            try:
                # Flush (not commit) so the unique constraint on
                # customer_project_id is checked now. If a concurrent
                # request already created this customer's MNRE profile
                # between our lookup above and this INSERT, this raises
                # IntegrityError instead of racing to create a second row.
                db.session.flush()
            except IntegrityError:
                db.session.rollback()
                profile = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
                action = "UPDATE"
                if not profile:
                    return jsonify({"error": "Could not save MNRE profile due to a conflicting update. Please try again."}), 409

        changes = {}

        # REMOVED: 'mnre_application_number' and 'registered_beneficiary_name'
        # handling used to be here. Neither is an actual column on the
        # MNREProfile model (models.py), so setting them was a no-op that
        # silently never persisted to the DB. Removed rather than adding the
        # columns, per decision to keep this model as-is.

        if 'mnre_status' in request.form:
            old_status = profile.mnre_status
            profile.mnre_status = request.form.get('mnre_status')
            if old_status != profile.mnre_status:
                changes['mnre_status'] = {"old": old_status, "new": profile.mnre_status}
                
        if 'comments' in request.form:
            old_comments = profile.comments
            profile.comments = request.form.get('comments')
            if old_comments != profile.comments:
                changes['comments'] = {"old": old_comments, "new": profile.comments}

        doc_fields = ['feasibility_file', 'ack_file']
        for field in doc_fields:
            if field in request.files:
                file_obj = request.files[field]
                if file_obj and file_obj.filename != '':
                    old_file_url = getattr(profile, field)
                    ext = file_obj.filename.rsplit('.', 1)[-1] if '.' in file_obj.filename else 'bin'
                    object_key = (
                        f"{folder_path}/{sanitize_path_segment(field)}"
                        f"_{sanitize_path_segment(cust.customer_id)}.{ext}"
                    )
                    try:
                        new_file_url = upload_to_r2(file_obj, object_key, content_type=file_obj.mimetype)
                    except Exception:
                        db.session.rollback()
                        return jsonify({"error": f"Failed to upload {field}. Please try again."}), 502
                    # Only delete the old file once the new one is confirmed
                    # uploaded, and only if one actually existed — mirrors the
                    # safer pattern in bank_loan.py.
                    if old_file_url:
                        delete_r2_file(old_file_url)
                    changes[field] = {"old": old_file_url, "new": new_file_url}
                    setattr(profile, field, new_file_url)

        profile.updated_by = uid
        profile.updated_at = datetime.utcnow()

        old_work_done = profile.work_done
        profile.work_done = "Completed" if profile.mnre_status == 'Completed' and profile.feasibility_file and profile.ack_file else "Pending"
        if old_work_done != profile.work_done:
            changes['work_done'] = {"old": old_work_done, "new": profile.work_done}

        if changes or action == "CREATE":
            log = CustomerAuditLog(
                customer_project_id=cust.id,
                user_id=uid,
                action=action,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {"initialized": True})
            )
            db.session.add(log)

        db.session.commit()
        return jsonify({"message": "Operational parameters tracked successfully", "profile": profile.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Save failed: {str(e)}"}), 500