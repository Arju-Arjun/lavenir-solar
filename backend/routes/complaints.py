from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
import json
import cloudinary.uploader

from models import db, Complaint, ComplaintAttachment, ComplaintComment, CustomerProject, User, CustomerAuditLog
from utils import is_admin_user, get_module_folder_path, sanitize_path_segment, delete_cloudinary_file
from routes.notification_rules import notify_module_staff, notify_assignee_and_admins

complaints_bp = Blueprint('complaints_bp', __name__)

MODULE_NAME = 'Complaints'

VALID_CATEGORIES = ['Technical', 'Billing', 'Service', 'Other']
VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
VALID_STATUSES = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Reopened']
CLOSED_STATUSES = Complaint.CLOSED_STATUSES
PRIORITY_RANK = {'Urgent': 3, 'High': 2, 'Medium': 1, 'Low': 0}

CATEGORY_MAX_LEN = 30


def _resolve_category(raw_category):
    raw_category = (raw_category or '').strip()
    if raw_category in VALID_CATEGORIES:
        return raw_category
    if raw_category:
        return raw_category[:CATEGORY_MAX_LEN]
    return 'Other'


def _log_action(customer_project_id, uid, action, changes):
    try:
        db.session.add(CustomerAuditLog(
            customer_project_id=customer_project_id,
            user_id=uid,
            action=action,
            module_name=MODULE_NAME,
            changes_payload=json.dumps(changes)
        ))
    except Exception as e:
        print(f"Failed to log action: {str(e)}")


def _incoming_files():
    """Support both a single 'file' field (legacy) and a multi-file 'files' field."""
    files = request.files.getlist('files')
    single = request.files.get('file')
    if single and single not in files:
        files = files + [single]
    return [f for f in files if f and f.filename]


def _save_attachments(complaint, files, uploaded_by):
    """Upload each file to Cloudinary and create a ComplaintAttachment row for it."""
    if not files:
        return []
    customer = complaint.customer
    folder_path = get_module_folder_path(customer.customer_name, customer.customer_id, 'complaints')
    saved = []
    for f in files:
        upload_result = cloudinary.uploader.upload(
            f,
            folder=folder_path,
            public_id=f"{complaint.complaint_number}_{sanitize_path_segment(f.filename)}"
        )
        attachment = ComplaintAttachment(
            complaint_id=complaint.id,
            file_url=upload_result.get('secure_url'),
            file_name=f.filename,
            uploaded_by=uploaded_by
        )
        db.session.add(attachment)
        saved.append(attachment)
    return saved


@complaints_bp.route('/customers-lookup', methods=['GET'])
@jwt_required()
def customers_lookup():
    query_text = (request.args.get('query') or '').strip()
    if not query_text:
        query_text = 'a'

    like_pattern = f"%{query_text}%"
    matches = (
        CustomerProject.query
        .filter(
            db.or_(
                CustomerProject.customer_name.ilike(like_pattern),
                CustomerProject.customer_id.ilike(like_pattern)
            )
        )
        .order_by(CustomerProject.customer_name.asc())
        .limit(20)
        .all()
    )

    return jsonify({"customers": [
        {
            "id": c.id,
            "customer_id": c.customer_id,
            "customer_name": c.customer_name,
            "district": c.district,
            "place": c.place,
        }
        for c in matches
    ]}), 200


@complaints_bp.route('/staff-list', methods=['GET'])
@jwt_required()
def get_staff_list():
    current_user_id = int(get_jwt_identity())
    if not is_admin_user(current_user_id):
        return jsonify({"error": "Unauthorized"}), 403

    staff_members = User.query.filter(
        User.role == 'staff',
        User.status == 'Active'
    ).all()

    return jsonify({
        "staff": [{"id": u.id, "full_name": u.full_name} for u in staff_members]
    }), 200


@complaints_bp.route('/create', methods=['POST'])
@jwt_required()
def create_complaint():
    current_user_id = int(get_jwt_identity())

    data = request.form if request.form else request.get_json() or {}
    files = _incoming_files()

    customer_project_id = data.get('customer_project_id')
    subject = (data.get('subject') or '').strip()
    description = (data.get('description') or '').strip()
    category = _resolve_category(data.get('category'))
    priority = data.get('priority', 'Medium')

    if not customer_project_id or not subject or not description:
        return jsonify({"error": "customer_project_id, subject and description are required."}), 400

    customer = CustomerProject.query.get(customer_project_id)
    if not customer:
        return jsonify({"error": "Customer not found"}), 404

    if priority not in VALID_PRIORITIES:
        priority = 'Medium'

    assignee = None
    raw_assigned_to = data.get('assigned_to')

    if raw_assigned_to:
        if not is_admin_user(current_user_id):
            return jsonify({"error": "Only admins can assign complaints.", "code": "ADMIN_ONLY_ASSIGN"}), 403
        assignee = User.query.get(raw_assigned_to)
        if not assignee:
            return jsonify({"error": "Selected staff member was not found."}), 400

    district_snapshot = (data.get('district_snapshot') or customer.district or '').strip()
    place_snapshot = (data.get('place_snapshot') or customer.place or '').strip()

    complaint = Complaint(
        customer_project_id=customer.id,
        subject=subject,
        description=description,
        category=category,
        priority=priority,
        district_snapshot=district_snapshot,
        place_snapshot=place_snapshot,
        status='Assigned' if assignee else 'Open',
        assigned_to=assignee.id if assignee else None,
        created_by=current_user_id,
        updated_by=current_user_id,
        complaint_number='PENDING'
    )
    db.session.add(complaint)

    try:
        db.session.flush()
        complaint.complaint_number = f"CMP-{complaint.id:05d}"
        complaint.compute_sla_due_at(from_time=complaint.created_at or datetime.utcnow())

        _save_attachments(complaint, files, uploaded_by=current_user_id)

        log_payload = {"subject": subject, "category": category, "priority": priority}
        if assignee:
            log_payload["assigned_to"] = assignee.id
        _log_action(customer.id, current_user_id, 'CREATE', log_payload)

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to register complaint: {str(e)}"}), 500

    notification_url = f"/customer-profile/{customer.customer_id}?tab=complaints"
    if assignee:
        notify_assignee_and_admins(
            assignee.id,
            title="Complaint Assigned to You",
            body=f"{complaint.complaint_number}: {subject} ({priority} priority) - {customer.customer_name}",
            url=notification_url
        )
    else:
        notify_module_staff(
            customer,
            title="New Complaint Registered",
            body=f"{complaint.complaint_number}: {subject} ({priority} priority) - {customer.customer_name}",
            notif_type="complaint_registered",
            gap_seconds=0
        )

    return jsonify({"message": "Complaint registered successfully.", "complaint": complaint.to_dict()}), 201


@complaints_bp.route('/all', methods=['GET'])
@jwt_required()
def get_all_complaints():
    query = Complaint.query

    status = request.args.get('status')
    if status:
        query = query.filter_by(status=status)

    category = request.args.get('category')
    if category:
        query = query.filter_by(category=category)

    priority = request.args.get('priority')
    if priority:
        query = query.filter_by(priority=priority)

    complaints = query.all()

    overdue_only = (request.args.get('overdue') or '').lower() in ('1', 'true', 'yes')
    if overdue_only:
        complaints = [c for c in complaints if c.is_overdue]

    sort_mode = request.args.get('sort', 'pending_oldest')
    if sort_mode == 'newest':
        complaints.sort(key=lambda c: c.created_at or datetime.min, reverse=True)
    elif sort_mode == 'priority':
        complaints.sort(key=lambda c: (
            -PRIORITY_RANK.get(c.priority, 0),
            c.created_at or datetime.min
        ))
    elif sort_mode == 'overdue':
        complaints.sort(key=lambda c: (
            not c.is_overdue,
            c.sla_due_at or datetime.max
        ))
    else:
        open_complaints = sorted(
            (c for c in complaints if c.status not in CLOSED_STATUSES),
            key=lambda c: c.created_at or datetime.min
        )
        closed_complaints = sorted(
            (c for c in complaints if c.status in CLOSED_STATUSES),
            key=lambda c: c.updated_at or datetime.min,
            reverse=True
        )
        complaints = open_complaints + closed_complaints

    return jsonify({"complaints": [c.to_dict() for c in complaints]}), 200


@complaints_bp.route('/<int:complaint_id>', methods=['GET'])
@jwt_required()
def get_complaint(complaint_id):
    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    return jsonify(complaint.to_dict()), 200


@complaints_bp.route('/<int:complaint_id>/edit', methods=['PATCH'])
@jwt_required()
def edit_complaint(complaint_id):
    current_user_id = int(get_jwt_identity())
    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    data = request.form if request.form else request.get_json() or {}
    files = _incoming_files()

    if 'subject' in data and data.get('subject').strip():
        complaint.subject = data.get('subject').strip()
    if 'description' in data and data.get('description').strip():
        complaint.description = data.get('description').strip()
    if 'category' in data:
        complaint.category = _resolve_category(data.get('category'))

    if 'priority' in data and data.get('priority') in VALID_PRIORITIES:
        new_priority = data.get('priority')
        if new_priority != complaint.priority:
            complaint.priority = new_priority
            # Only push the SLA clock for complaints that are still open - a
            # resolved/closed complaint's SLA snapshot shouldn't move.
            if complaint.status not in CLOSED_STATUSES:
                complaint.compute_sla_due_at(from_time=complaint.created_at)

    if 'district_snapshot' in data:
        complaint.district_snapshot = data.get('district_snapshot').strip()
    if 'place_snapshot' in data:
        complaint.place_snapshot = data.get('place_snapshot').strip()

    if 'status' in data and data.get('status') in VALID_STATUSES:
        new_status = data.get('status')
        if new_status in ('Resolved', 'Closed') and not (data.get('resolution_notes') or complaint.resolution_notes):
            return jsonify({"error": "resolution_notes is required to resolve or close a complaint."}), 400

        complaint.status = new_status
        now = datetime.utcnow()
        if new_status == 'Resolved':
            complaint.resolved_at = now
        elif new_status == 'Closed':
            complaint.closed_at = now
        elif new_status == 'Reopened':
            complaint.resolved_at = None
            complaint.closed_at = None
            complaint.reopen_count = (complaint.reopen_count or 0) + 1
            complaint.compute_sla_due_at(from_time=now)

    if 'resolution_notes' in data:
        complaint.resolution_notes = data.get('resolution_notes')

    if 'assigned_to' in data and is_admin_user(current_user_id):
        assignee = User.query.get(data.get('assigned_to')) if data.get('assigned_to') else None
        if assignee:
            complaint.assigned_to = assignee.id
            if complaint.status in ('Open', 'Reopened'):
                complaint.status = 'Assigned'

    complaint.updated_by = current_user_id

    try:
        if files:
            _save_attachments(complaint, files, uploaded_by=current_user_id)

        _log_action(complaint.customer_project_id, current_user_id, 'UPDATE', {"action": "Complaint updated"})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to update complaint: {str(e)}"}), 500

    return jsonify({"message": "Complaint updated successfully.", "complaint": complaint.to_dict()}), 200


@complaints_bp.route('/<int:complaint_id>/attachments', methods=['POST'])
@jwt_required()
def add_attachments(complaint_id):
    current_user_id = int(get_jwt_identity())
    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    files = _incoming_files()
    if not files:
        return jsonify({"error": "No file(s) provided."}), 400

    try:
        saved = _save_attachments(complaint, files, uploaded_by=current_user_id)
        _log_action(complaint.customer_project_id, current_user_id, 'UPDATE',
                    {"action": "Attachment(s) added", "count": len(saved)})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to upload attachment(s): {str(e)}"}), 500

    return jsonify({"message": "Attachment(s) added.", "complaint": complaint.to_dict()}), 201


@complaints_bp.route('/<int:complaint_id>/attachments/<int:attachment_id>', methods=['DELETE'])
@jwt_required()
def delete_attachment(complaint_id, attachment_id):
    current_user_id = int(get_jwt_identity())
    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    attachment = ComplaintAttachment.query.filter_by(id=attachment_id, complaint_id=complaint_id).first()
    if not attachment:
        return jsonify({"error": "Attachment not found"}), 404

    try:
        if complaint.customer:
            folder_path = get_module_folder_path(
                complaint.customer.customer_name, complaint.customer.customer_id, 'complaints'
            )
            delete_cloudinary_file(attachment.file_url, folder_path)

        db.session.delete(attachment)
        _log_action(complaint.customer_project_id, current_user_id, 'UPDATE',
                    {"action": "Attachment removed", "file_name": attachment.file_name})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete attachment: {str(e)}"}), 500

    return jsonify({"message": "Attachment deleted."}), 200


@complaints_bp.route('/<int:complaint_id>/comments', methods=['POST'])
@jwt_required()
def add_comment(complaint_id):
    current_user_id = int(get_jwt_identity())
    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    data = request.get_json() or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({"error": "message is required."}), 400

    is_internal = bool(data.get('is_internal', False))
    if is_internal and not is_admin_user(current_user_id):
        # keep internal notes to admin/staff-only usage; non-admin callers
        # get a normal customer-facing comment instead of a silent no-op
        is_internal = False

    comment = ComplaintComment(
        complaint_id=complaint.id,
        user_id=current_user_id,
        message=message,
        is_internal=is_internal
    )
    db.session.add(comment)

    try:
        _log_action(complaint.customer_project_id, current_user_id, 'UPDATE', {"action": "Comment added"})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to add comment: {str(e)}"}), 500

    return jsonify({"message": "Comment added.", "comment": comment.to_dict()}), 201


@complaints_bp.route('/<int:complaint_id>/comments/<int:comment_id>', methods=['DELETE'])
@jwt_required()
def delete_comment(complaint_id, comment_id):
    current_user_id = int(get_jwt_identity())
    comment = ComplaintComment.query.filter_by(id=comment_id, complaint_id=complaint_id).first()
    if not comment:
        return jsonify({"error": "Comment not found"}), 404

    if comment.user_id != current_user_id and not is_admin_user(current_user_id):
        return jsonify({"error": "Unauthorized"}), 403

    complaint = Complaint.query.get(complaint_id)

    try:
        db.session.delete(comment)
        if complaint:
            _log_action(complaint.customer_project_id, current_user_id, 'UPDATE', {"action": "Comment removed"})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete comment: {str(e)}"}), 500

    return jsonify({"message": "Comment deleted."}), 200


@complaints_bp.route('/<int:complaint_id>', methods=['DELETE'])
@jwt_required()
def delete_complaint(complaint_id):
    current_user_id = int(get_jwt_identity())

    complaint = Complaint.query.get(complaint_id)
    if not complaint:
        return jsonify({"error": "Complaint not found"}), 404

    _log_action(
        complaint.customer_project_id,
        current_user_id,
        'DELETE',
        {"complaint_number": complaint.complaint_number, "subject": complaint.subject, "action_note": "Complaint deleted"}
    )

    if complaint.attachments and complaint.customer:
        folder_path = get_module_folder_path(
            complaint.customer.customer_name, complaint.customer.customer_id, 'complaints'
        )
        for attachment in list(complaint.attachments):
            delete_cloudinary_file(attachment.file_url, folder_path)

    # ComplaintAttachment and ComplaintComment rows cascade-delete automatically
    # (cascade="all, delete-orphan" + ondelete='CASCADE' on the FK).
    db.session.delete(complaint)
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete complaint: {str(e)}"}), 500

    return jsonify({"message": "Complaint deleted."}), 200