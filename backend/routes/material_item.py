from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import MaterialDeliveryItem, MaterialDelivery, CustomerProject, User, CustomerAuditLog, db
from datetime import datetime
import json
from utils import check_permission

material_item_bp = Blueprint('material_item', __name__)
MODULE_NAME = 'Installation Progress'  # Shared tracking module context




def _serialize_item(item):
    return {
        "id": item.id,
        "sl_no": item.sl_no,
        "material_name": item.material_name,
        "unit": item.unit,
        "quantity": item.quantity,
        "used_quantity": item.used_quantity,
        "remaining_quantity": item.remaining_quantity,
        "work_done": item.work_done,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None
    }

@material_item_bp.route('/<string:customer_id>/items/', methods=['GET'])
@jwt_required()

def get_delivery_items(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not check_permission(uid, 'view', 'Material Delivery'):
        return jsonify({"error": "Unauthorized view access parameters."}), 403

    customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer_project or not customer_project.material_delivery_rel:
        return jsonify({"items": []}), 200

    items = sorted(customer_project.material_delivery_rel.material_items, key=lambda i: i.sl_no or 0)
    return jsonify({"items": [_serialize_item(item) for item in items]}), 200

@material_item_bp.route('/<int:item_id>/usage/', methods=['PUT'])
@jwt_required()
def update_item_usage(item_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    is_admin = user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized modification clearance."}), 403

    item = MaterialDeliveryItem.query.get(item_id)
    if not item:
        return jsonify({"error": "Material item reference missing."}), 404

    data = request.get_json() or {}
    if 'used_quantity' in data and data.get('used_quantity') is not None:
        try:
            used = float(data.get('used_quantity'))
            delivered = item.quantity or 0.0
            used = max(0.0, min(used, delivered))
            
            old_used = item.used_quantity
            item.used_quantity = used
            item.remaining_quantity = delivered - used
            
            # Auto evaluate local status row metric
            item.work_done = "Completed" if used == delivered else "Pending"
            
            db.session.commit()
            
            # Log dynamic modifications pipeline data
            audit_log = CustomerAuditLog(
                customer_project_id=item.delivery.customer_project_id,
                user_id=uid,
                action="UPDATE",
                module_name=MODULE_NAME,
                changes_payload=json.dumps({"item_id": item_id, "used_quantity": {"old": old_used, "new": used}})
            )
            db.session.add(audit_log)
            db.session.commit()
            
            return jsonify({"message": "Usage ledger matrix metrics updated successfully.", "item": _serialize_item(item)}), 200
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid decimal quantity precision formatting format data."}), 400

    return jsonify({"error": "Missing usage values fields indicators."}), 400