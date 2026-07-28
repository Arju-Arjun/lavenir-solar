from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, CustomerProject, SiteVisit, BankLoan, Payment, CustomerAuditLog, PermissionRequest
from utils import (
    check_permission, 
    delete_cloudinary_file, 
    handle_blueprint_check_access, 
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment
)
from datetime import datetime
import cloudinary
import cloudinary.uploader
import json

payment_bp = Blueprint('payment_bp', __name__)

MODULE_NAME = 'Payment Flow'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'payment'

@payment_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    # Automatically pulls view/update permissions and active pending requests via utils.py
    return handle_blueprint_check_access(uid, MODULE_NAME)


@payment_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@payment_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_payment(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    
    is_admin = user and user.role and user.role.strip().lower() == 'admin'
    if not is_admin and not check_permission(uid, 'view', MODULE_NAME):
        return jsonify({"error": "Unauthorized access. View permissions missing."}), 403
        
    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"payment": None, "message": "Customer project record not found."}), 404

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()
    project_cost = float(site_visit.project_cost) if (site_visit and site_visit.project_cost) else 0.0

    bank_loan = BankLoan.query.filter_by(customer_project_id=cust.id).first()
    loan_amount = float(bank_loan.total_loan_amount) if (bank_loan and bank_loan.need_loan and bank_loan.total_loan_amount) else 0.0

    payment = Payment.query.filter_by(customer_project_id=cust.id).first()
    
    return jsonify({
        "payment": payment.to_dict() if payment else None,
        "project_cost": project_cost,
        "loan_amount": loan_amount
    }), 200


@payment_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_payment(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    is_admin = user and user.role and user.role.strip().lower() == 'admin'

    cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not cust:
        return jsonify({"error": "Customer project record not found."}), 404

    # Centralized storage folder for this customer + module, e.g.:
    # lavenir/JohnDoe_1023/payment
    folder_path = get_module_folder_path(cust.customer_name, cust.customer_id, FOLDER_MODULE_NAME)

    payment = Payment.query.filter_by(customer_project_id=cust.id).first()
    action = "UPDATE" if payment else "CREATE"
    
    if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
        return jsonify({"error": "Unauthorized permission tier clearance missing."}), 403

    if not payment:
        payment = Payment(customer_project_id=cust.id, created_by=uid)
        db.session.add(payment)

    changes = {}

    site_visit = SiteVisit.query.filter_by(customer_project_id=cust.id).first()
    project_cost = float(site_visit.project_cost) if (site_visit and site_visit.project_cost) else 0.0

    bank_loan = BankLoan.query.filter_by(customer_project_id=cust.id).first()
    loan_amount = float(bank_loan.total_loan_amount) if (bank_loan and bank_loan.need_loan and bank_loan.total_loan_amount) else 0.0
    
    if 'advance_amount' in request.form:
        old_val = float(payment.advance_amount or 0.0)
        new_val = float(request.form.get('advance_amount') or 0.0)
        payment.advance_amount = new_val
        if old_val != new_val:
            changes['advance_amount'] = {"old": old_val, "new": new_val}

    if 'advance_amount_date' in request.form:
        old_val = payment.advance_amount_date
        date_str = request.form.get('advance_amount_date')
        try:
            payment.advance_amount_date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else None
        except ValueError:
            payment.advance_amount_date = None
        if old_val != payment.advance_amount_date:
            changes['advance_amount_date'] = {"old": str(old_val), "new": str(payment.advance_amount_date)}

    if 'second_payment' in request.form:
        old_val = float(payment.second_payment or 0.0)
        new_val = float(request.form.get('second_payment') or 0.0)
        payment.second_payment = new_val
        if old_val != new_val:
            changes['second_payment'] = {"old": old_val, "new": new_val}

    if 'second_payment_date' in request.form:
        old_val = payment.second_payment_date
        date_str = request.form.get('second_payment_date')
        try:
            payment.second_payment_date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else None
        except ValueError:
            payment.second_payment_date = None
        if old_val != payment.second_payment_date:
            changes['second_payment_date'] = {"old": str(old_val), "new": str(payment.second_payment_date)}

    if 'payment_method' in request.form:
        old_val = payment.payment_method
        payment.payment_method = request.form.get('payment_method')
        if old_val != payment.payment_method:
            changes['payment_method'] = {"old": old_val, "new": payment.payment_method}

    if 'comments' in request.form:
        old_val = payment.comments
        payment.comments = request.form.get('comments')
        if old_val != payment.comments:
            changes['comments'] = {"old": old_val, "new": payment.comments}

    if 'additional_payments' in request.form:
        old_val = payment.additional_payments
        add_pay_data = json.loads(request.form.get('additional_payments') or '[]')
        payment.additional_payments = json.dumps(add_pay_data)
        if old_val != payment.additional_payments:
            changes['additional_payments'] = {"old": old_val, "new": add_pay_data}

    try:
        parsed_additional = json.loads(payment.additional_payments or '[]')
    except Exception:
        parsed_additional = []
        
    additional_total = sum(float(p.get('amount', 0.0)) for p in parsed_additional)
    payment.total_amount_received = loan_amount + float(payment.advance_amount or 0) + float(payment.second_payment or 0) + additional_total
    payment.due_amount = project_cost - payment.total_amount_received

    current_proofs = []
    if payment.proof_file:
        try:
            current_proofs = json.loads(payment.proof_file)
            if not isinstance(current_proofs, list):
                current_proofs = [payment.proof_file] if payment.proof_file else []
        except Exception:
            current_proofs = [payment.proof_file]

    removed_urls = json.loads(request.form.get('removed_proofs', '[]'))
    for target_url in removed_urls:
        if target_url in current_proofs:
            delete_cloudinary_file(target_url, folder_path)
            current_proofs.remove(target_url)

    uploaded_files = request.files.getlist('proof_files')
    new_uploads_tracked = []
    # Continue numbering from where the existing proof list left off so each
    # proof gets a unique public_id within the same module folder.
    start_index = len(current_proofs) + 1
    for i, file_obj in enumerate(uploaded_files):
        if file_obj and file_obj.filename != '':
            public_id = f"proof{start_index + i}_{sanitize_path_segment(cust.customer_id)}"
            res = cloudinary.uploader.upload(
                file_obj, folder=folder_path, public_id=public_id, overwrite=True
            )
            current_proofs.append(res['secure_url'])
            new_uploads_tracked.append(res['secure_url'])

    if new_uploads_tracked or removed_urls:
        changes['proof_files'] = {"added": new_uploads_tracked, "removed": removed_urls}
        
    payment.proof_file = json.dumps(current_proofs)

    if payment.due_amount == 0.0 and float(payment.advance_amount or 0) > 0 and float(payment.second_payment or 0) > 0 and payment.proof_file and len(current_proofs) > 0:
        payment.work_done = 'Completed'
    else:
        payment.work_done = 'Pending'

    payment.updated_by = uid
    payment.updated_at = datetime.utcnow()

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
    return jsonify({"message": "Payment records saved successfully", "payment": payment.to_dict()}), 200