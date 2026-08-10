from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, Notification

notifications_bp = Blueprint('notifications', __name__)

MAX_PER_PAGE = 100


@notifications_bp.route('', methods=['GET'])
@jwt_required()
def get_notifications():
    user_id = int(get_jwt_identity())

    # Pagination params
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 15, type=int)
    page = max(page, 1)
    per_page = min(max(per_page, 1), MAX_PER_PAGE)  # CHANGED: was unbounded - a client (or bug) could pass per_page=100000 and force a huge query

    base_query = Notification.query.filter(
        (Notification.user_id == user_id) | (Notification.user_id.is_(None))
    ).order_by(Notification.created_at.desc())

    total_count = base_query.count()
    notifs = base_query.offset((page - 1) * per_page).limit(per_page).all()

    # unread count should be global, not just current page
    unread_count = Notification.query.filter(
        (Notification.user_id == user_id) | (Notification.user_id.is_(None)),
        Notification.is_read == False
    ).count()

    has_more = (page * per_page) < total_count

    return jsonify({
        "notifications": [n.to_dict() for n in notifs],
        "unread_count": unread_count,
        "has_more": has_more,
        "page": page
    })


@notifications_bp.route('/<int:notif_id>/read', methods=['PUT'])
@jwt_required()
def mark_read(notif_id):
    user_id = int(get_jwt_identity())
    notif = Notification.query.get_or_404(notif_id)

    # CHANGED: previously any authenticated user could mark ANY notification
    # (including ones addressed to a different specific user_id) as read just
    # by guessing/incrementing the id - get_or_404 alone checks existence,
    # not ownership. Broadcast rows (user_id is None) stay markable by anyone
    # they're visible to, same as get_notifications' own filter above.
    if notif.user_id is not None and notif.user_id != user_id:
        return jsonify({"error": "Not authorized to modify this notification"}), 403

    notif.is_read = True
    db.session.commit()
    return jsonify({"success": True})


@notifications_bp.route('/read-all', methods=['PUT'])
@jwt_required()
def mark_all_read():
    user_id = int(get_jwt_identity())
    updated = Notification.query.filter(
        (Notification.user_id == user_id) | (Notification.user_id.is_(None)),
        Notification.is_read == False  # CHANGED: skip rows already read instead of rewriting every row every time
    ).update({"is_read": True}, synchronize_session=False)
    db.session.commit()
    return jsonify({"success": True, "updated": updated})


# ---------------------------------------------------------------------------
# POPUP QUEUE (center-screen modal, separate from bell/is_read)
# ---------------------------------------------------------------------------

# Safety cap so one runaway notif_type can't hand the frontend an endless
# queue - oldest-first (FIFO), same ordering the frontend should pop through.
MAX_PENDING_POPUPS = 25


@notifications_bp.route('/popups/pending', methods=['GET'])
@jwt_required()
def get_pending_popups():
    """
    Everything still owed to this user as a popup: not yet closed by them
    (popup_seen) and not auto-cleared because the underlying work finished
    (popup_resolved). Frontend calls this on login / on every page load and
    shows them one at a time, oldest first.
    """
    user_id = int(get_jwt_identity())

    pending = Notification.query.filter(
        (Notification.user_id == user_id) | (Notification.user_id.is_(None)),
        Notification.popup_seen == False,
        Notification.popup_resolved == False
    ).order_by(Notification.created_at.asc()).limit(MAX_PENDING_POPUPS).all()

    return jsonify({"popups": [n.to_dict() for n in pending]})


@notifications_bp.route('/<int:notif_id>/popup-seen', methods=['PUT'])
@jwt_required()
def mark_popup_seen(notif_id):
    """Called when the user closes the popup via X or OK."""
    user_id = int(get_jwt_identity())
    notif = Notification.query.get_or_404(notif_id)

    # Same ownership check as mark_read - broadcast rows (user_id is None)
    # stay dismissable by anyone they're visible to.
    if notif.user_id is not None and notif.user_id != user_id:
        return jsonify({"error": "Not authorized to modify this notification"}), 403

    notif.popup_seen = True
    db.session.commit()
    return jsonify({"success": True})