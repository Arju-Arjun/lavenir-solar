from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, UserPermission, User, PermissionRequest
from utils import handle_get_all_permissions, is_admin_user
import json

permissions_bp = Blueprint('permissions_bp', __name__)


def _normalize_tier(permission_type):
    # check_permission()/handle_blueprint_check_access only ever look at
    # 'view', 'update', or 'delete' in the matrix — 'create' isn't a real
    # matrix key, it's treated as equivalent to 'update'.
    return 'update' if permission_type == 'create' else permission_type


def reconcile_pending_requests(user_id=None):
    """
    Marks any Pending PermissionRequest as Approved if the staff member's
    current live matrix already grants that module/tier. Called both after
    a direct matrix save (so newly-granted rights resolve immediately) and
    whenever the inbox is fetched (so rows that were already covered by an
    earlier matrix save, or granted out of order, self-heal on view instead
    of sitting stale forever). Returns the number of requests resolved.
    """
    query = PermissionRequest.query.filter_by(status='Pending')
    if user_id is not None:
        query = query.filter_by(user_id=user_id)
    pending_requests = query.all()
    if not pending_requests:
        return 0

    affected_user_ids = {req.user_id for req in pending_requests}
    matrices = {
        record.user_id: record
        for record in UserPermission.query.filter(UserPermission.user_id.in_(affected_user_ids)).all()
    }

    resolved = 0
    for req in pending_requests:
        matrix_record = matrices.get(req.user_id)
        if not matrix_record:
            continue
        try:
            current_matrix = json.loads(matrix_record.permissions_matrix) if matrix_record.permissions_matrix else {}
        except Exception:
            current_matrix = {}

        module_rights = current_matrix.get(req.module_name, {})
        requested_tier = _normalize_tier(req.permission_type)
        if module_rights.get(requested_tier):
            req.status = 'Approved'
            resolved += 1

    return resolved

@permissions_bp.route('/user-matrix', methods=['GET'])
@jwt_required()
def get_logged_in_user_matrix():
    """
    Optimized Global Context Route: Fetches the entire permission matrix 
    for the currently logged-in user in a single network call.
    URL Path: GET /api/staff/permissions/user-matrix
    """
    try:
        current_user_id = int(get_jwt_identity())
        return handle_get_all_permissions(current_user_id)
    except Exception as e:
        return jsonify({"error": f"Failed to extract authorization identity: {str(e)}"}), 500


@permissions_bp.route('/get/<int:user_id>', methods=['GET'])
@jwt_required()
def get_staff_permissions(user_id):
    """
    Admin View Route: Fetches individual staff member matrix mappings by ID 
    for the Super Admin dashboard workspace.
    """
    current_user_id = int(get_jwt_identity())
    if not is_admin_user(current_user_id):
        return jsonify({"error": "Permission Denied", "code": "ADMIN_ONLY"}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Staff member not found"}), 404

    matrix_record = UserPermission.query.filter_by(user_id=user_id).first()
    if not matrix_record:
        return jsonify({"user_id": user_id, "permissions_matrix": {}}), 200
        
    return jsonify(matrix_record.to_dict()), 200


@permissions_bp.route('/update/<int:user_id>', methods=['POST'])
@jwt_required()
def update_staff_permissions(user_id):
    """
    Admin Command Route: Overwrites or inserts a staff member's live 
    permission JSON matrix registry block.
    """
    current_user_id = int(get_jwt_identity())
    if not is_admin_user(current_user_id):
        return jsonify({"error": "Permission Denied", "code": "ADMIN_ONLY"}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Staff member not found"}), 404

    data = request.get_json()
    new_matrix = data.get('permissions_matrix', {})

    matrix_record = UserPermission.query.filter_by(user_id=user_id).first()
    if not matrix_record:
        matrix_record = UserPermission(user_id=user_id, permissions_matrix=json.dumps(new_matrix))
        db.session.add(matrix_record)
    else:
        matrix_record.permissions_matrix = json.dumps(new_matrix)

    # matrix_record.permissions_matrix now holds the new_matrix JSON above,
    # so reconciling against the DB record (rather than new_matrix directly)
    # keeps this in sync with reconcile_pending_requests' single source of truth.
    reconcile_pending_requests(user_id=user_id)

    try:
        db.session.commit()
        return jsonify({"message": "Staff authorization registry updated successfully."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Database transaction execution failure: {str(e)}"}), 500


@permissions_bp.route('/requests/all', methods=['GET'])
@jwt_required()
def get_all_permission_requests():
    """
    Request Center Route: Returns every PermissionRequest split into
    pending vs. processed (Approved/Rejected), serialized into the
    shape PermissionRequests.jsx expects.
    URL Path: GET /api/staff/permissions/requests/all
    """
    current_user_id = int(get_jwt_identity())
    if not is_admin_user(current_user_id):
        return jsonify({"error": "Permission Denied", "code": "ADMIN_ONLY"}), 403

    # Self-heal: any pending request already covered by the staff member's
    # current live matrix (e.g. granted directly before or independent of
    # this request being resolved) gets flipped to Approved before we
    # serialize the list, so the inbox never shows a stale Pending row.
    resolved_count = reconcile_pending_requests()
    if resolved_count:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    all_requests = PermissionRequest.query.order_by(PermissionRequest.requested_at.desc()).all()

    def serialize(req):
        return {
            "id": req.id,
            "staff_name": req.user.full_name if req.user else "Unknown",
            "requested_module": req.module_name,
            "requested_tier": req.permission_type,
            "request_date": req.requested_at.strftime("%d/%m/%Y") if req.requested_at else None,
            "status": req.status,
        }

    pending = [serialize(r) for r in all_requests if r.status == 'Pending']
    processed = [serialize(r) for r in all_requests if r.status != 'Pending']

    return jsonify({"pending": pending, "processed": processed}), 200


@permissions_bp.route('/requests/process/<int:request_id>', methods=['POST'])
@jwt_required()
def process_permission_request(request_id):
    """
    Admin Request Processing Route: Resolves administrative tier elevation requests 
    by changing status and updating the live matrix upon approval.
    """
    current_user_id = int(get_jwt_identity())
    if not is_admin_user(current_user_id):
        return jsonify({"error": "Permission Denied", "code": "ADMIN_ONLY"}), 403

    data = request.get_json()
    action = data.get('action')

    if action not in ['Approved', 'Rejected']:
        return jsonify({"error": "Invalid action execution parameter."}), 400

    req = PermissionRequest.query.get(request_id)
    if not req:
        return jsonify({"error": "Targeted access upgrade request context missing."}), 404

    req.status = action
    
    try:
        if action == 'Approved':
            matrix_record = UserPermission.query.filter_by(user_id=req.user_id).first()
            if not matrix_record:
                matrix_record = UserPermission(user_id=req.user_id, permissions_matrix="{}")
                db.session.add(matrix_record)
                
            try:
                current_matrix = json.loads(matrix_record.permissions_matrix) if matrix_record.permissions_matrix else {}
            except Exception:
                current_matrix = {}
                
            if req.module_name not in current_matrix:
                current_matrix[req.module_name] = {"view": True, "update": False, "delete": False}

            # check_permission() only ever reads 'view', 'update', or 'delete' from
            # the matrix — 'create' is never checked anywhere. Approving a 'create'
            # request as-is would silently grant nothing. handle_blueprint_check_access
            # already treats create and update as the same capability, so normalize
            # here to match what's actually enforced.
            grant_type = 'update' if req.permission_type == 'create' else req.permission_type
            current_matrix[req.module_name][grant_type] = True

            if grant_type in ['update', 'delete']:
                current_matrix[req.module_name]['view'] = True
                
            matrix_record.permissions_matrix = json.dumps(current_matrix)
            
        db.session.commit()
        return jsonify({
            "message": f"Request status successfully updated to {action}.",
            "request_id": request_id,
            "status": action
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Database write transaction failed: {str(e)}"}), 500