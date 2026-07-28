from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, Notification

notifications_bp = Blueprint('notifications', __name__)


@notifications_bp.route('', methods=['GET'])
@jwt_required()
def get_notifications():
    user_id = int(get_jwt_identity())

    # Pagination params
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 15, type=int)

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
    notif = Notification.query.get_or_404(notif_id)
    notif.is_read = True
    db.session.commit()
    return jsonify({"success": True})


@notifications_bp.route('/read-all', methods=['PUT'])
@jwt_required()
def mark_all_read():
    user_id = int(get_jwt_identity())
    Notification.query.filter(
        (Notification.user_id == user_id) | (Notification.user_id.is_(None))
    ).update({"is_read": True}, synchronize_session=False)
    db.session.commit()
    return jsonify({"success": True})