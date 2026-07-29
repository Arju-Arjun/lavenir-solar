import os
import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from pywebpush import webpush, WebPushException
from models import db, PushSubscription, Notification

push_bp = Blueprint('push', __name__)

VAPID_PUBLIC_KEY = os.getenv('VAPID_PUBLIC_KEY', 'BDKPUxbcUpXjyoZ7kaXFvfK8ZNuaipR1SnBE15Yr0320VQ0RuAhbhwcsWsgIL4yOZHCmxRn1p6E0p-r7zr8_fL4')
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY', 'DL_0FYo8nSAVQ5PV7RxVQ4Ds-Qdr2hPCSWsI7IMlFJg')
VAPID_CLAIMS = {"sub": os.getenv('VAPID_CLAIM_EMAIL', 'mailto:arjun.ai.tinos@gmail.com')}


@push_bp.route('/vapid-public-key', methods=['GET'])
def get_public_key():
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@push_bp.route('/subscribe', methods=['POST'])
@jwt_required()
def subscribe():
    user_id = int(get_jwt_identity())
    data = request.json
    endpoint = data.get('endpoint')
    keys = data.get('keys', {})

    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if existing:
        existing.user_id = user_id
        db.session.commit()
        return jsonify({"success": True, "message": "Subscription updated"})

    sub = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh=keys.get('p256dh'),
        auth=keys.get('auth')
    )
    db.session.add(sub)
    db.session.commit()
    return jsonify({"success": True})


@push_bp.route('/unsubscribe', methods=['POST'])
@jwt_required()
def unsubscribe():
    endpoint = request.json.get('endpoint')
    sub = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if sub:
        db.session.delete(sub)
        db.session.commit()
    return jsonify({"success": True})


def send_push_to_subscriptions(subscriptions, title, body, url='/'):
    """Reusable helper — call this from other routes too (e.g. after payment created)"""
    failed = []
    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS.copy()
            )
        except WebPushException as ex:
            print("Push failed:", repr(ex))
            failed.append(sub.endpoint)
            if ex.response is not None and ex.response.status_code in (404, 410):
                db.session.delete(sub)
    db.session.commit()
    return failed


def create_notification_and_push(title, body, url='/', notif_type='general', user_id=None, customer_project_id=None):
    """
    Plain, jwt/request-free version of the notification+push logic.
    Callable from anywhere in the backend — background scheduler jobs
    (notification_rules.py) or other route handlers (e.g. service.py after
    a service log is created) — not just from an authenticated HTTP request.

    1. Always saves a Notification row (so it shows in the bell dropdown,
       even if the user has no active push subscription / denied permission).
    2. Attempts an actual browser/mobile push on top of that, best-effort.
    """
    notif = Notification(
        user_id=user_id,
        title=title,
        message=body,
        url=url,
        notif_type=notif_type,
        customer_project_id=customer_project_id
    )
    db.session.add(notif)
    db.session.commit()

    query = PushSubscription.query
    if user_id:
        query = query.filter_by(user_id=user_id)
    subscriptions = query.all()
    failed = send_push_to_subscriptions(subscriptions, title, body, url)

    return {"sent": len(subscriptions) - len(failed), "failed": len(failed)}


@push_bp.route('/send', methods=['POST'])
@jwt_required()
def send_notification():
    data = request.json
    result = create_notification_and_push(
        title=data.get('title', 'Notification'),
        body=data.get('body', ''),
        url=data.get('url', '/'),
        notif_type=data.get('notif_type', 'general'),
        user_id=data.get('user_id')
    )
    return jsonify({"success": True, **result})