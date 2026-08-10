from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, CustomerProject, SiteVisit, BankLoan, Payment, CustomerAuditLog
from utils import (
    check_permission,
    delete_r2_file,
    upload_to_r2,
    handle_blueprint_check_access,
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment,
)
from datetime import datetime
import json

payment_bp = Blueprint('payment_bp', __name__)

MODULE_NAME = 'Payment Flow'
FOLDER_MODULE_NAME = 'payment'

# Below this, due_amount is treated as "fully settled" - money math on floats
# rarely lands on an exact 0.0, so an equality check would silently never
# mark a fully-paid record as Completed.
DUE_AMOUNT_EPSILON = 0.01


@payment_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
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
        "loan_amount": loan_amount,
    }), 200


@payment_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_payment(customer_id):
    try:
        uid = get_jwt_identity()
        user = User.query.get(uid)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'
        if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
            return jsonify({"error": "Unauthorized permission tier clearance missing."}), 403

        cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not cust:
            return jsonify({"error": "Customer project record not found."}), 404

        # e.g. lavenir/JohnDoe_1023/payment
        folder_path = get_module_folder_path(cust.customer_name, cust.customer_id, FOLDER_MODULE_NAME)

        payment = Payment.query.filter_by(customer_project_id=cust.id).first()
        action = "UPDATE" if payment else "CREATE"

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
            try:
                new_val = float(request.form.get('advance_amount') or 0.0)
            except ValueError:
                return jsonify({"error": "Invalid advance_amount value."}), 400
            if new_val < 0:
                return jsonify({"error": "advance_amount cannot be negative."}), 400
            payment.advance_amount = new_val
            if old_val != new_val:
                changes['advance_amount'] = {"old": old_val, "new": new_val}

        if 'advance_amount_date' in request.form:
            old_val = payment.advance_amount_date
            date_str = request.form.get('advance_amount_date')
            try:
                # Keep this a full datetime (not .date()) so it matches the
                # DateTime column's type and old_val (also a datetime) can
                # be compared correctly instead of always mismatching.
                payment.advance_amount_date = datetime.strptime(date_str, '%Y-%m-%d') if date_str else None
            except ValueError:
                return jsonify({"error": "Invalid advance_amount_date. Expected YYYY-MM-DD."}), 400
            if old_val != payment.advance_amount_date:
                changes['advance_amount_date'] = {
                    "old": old_val.isoformat() if old_val else None,
                    "new": payment.advance_amount_date.isoformat() if payment.advance_amount_date else None
                }

        if 'second_payment' in request.form:
            old_val = float(payment.second_payment or 0.0)
            try:
                new_val = float(request.form.get('second_payment') or 0.0)
            except ValueError:
                return jsonify({"error": "Invalid second_payment value."}), 400
            if new_val < 0:
                return jsonify({"error": "second_payment cannot be negative."}), 400
            payment.second_payment = new_val
            if old_val != new_val:
                changes['second_payment'] = {"old": old_val, "new": new_val}

        if 'second_payment_date' in request.form:
            old_val = payment.second_payment_date
            date_str = request.form.get('second_payment_date')
            try:
                payment.second_payment_date = datetime.strptime(date_str, '%Y-%m-%d') if date_str else None
            except ValueError:
                return jsonify({"error": "Invalid second_payment_date. Expected YYYY-MM-DD."}), 400
            if old_val != payment.second_payment_date:
                changes['second_payment_date'] = {
                    "old": old_val.isoformat() if old_val else None,
                    "new": payment.second_payment_date.isoformat() if payment.second_payment_date else None
                }

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
            try:
                old_parsed = json.loads(old_val) if old_val else []
            except Exception:
                old_parsed = []
            try:
                add_pay_data = json.loads(request.form.get('additional_payments') or '[]')
                if not isinstance(add_pay_data, list):
                    raise ValueError("additional_payments must be a list")
                for item in add_pay_data:
                    # Validates each row up front so a bad amount doesn't silently
                    # become 0 further down in the total_amount calculation.
                    amt = float(item.get('amount', 0.0))
                    if amt < 0:
                        raise ValueError("additional_payments amounts cannot be negative")
            except Exception:
                return jsonify({"error": "Invalid additional_payments payload. Amounts must be non-negative numbers."}), 400
            payment.additional_payments = json.dumps(add_pay_data)
            # Compare parsed values, not the raw strings, so re-serializing
            # unchanged data (different key order/spacing) doesn't get logged
            # as a spurious change.
            if old_parsed != add_pay_data:
                changes['additional_payments'] = {"old": old_parsed, "new": add_pay_data}

        try:
            parsed_additional = json.loads(payment.additional_payments or '[]')
        except Exception:
            parsed_additional = []

        additional_total = sum(float(p.get('amount', 0.0)) for p in parsed_additional)
        payment.total_amount = loan_amount + float(payment.advance_amount or 0) + float(payment.second_payment or 0) + additional_total
        payment.due_amount = project_cost - payment.total_amount

        current_proofs = []
        if payment.proof_file:
            try:
                current_proofs = json.loads(payment.proof_file)
                if not isinstance(current_proofs, list):
                    current_proofs = [payment.proof_file] if payment.proof_file else []
            except Exception:
                current_proofs = [payment.proof_file]

        try:
            removed_urls = json.loads(request.form.get('removed_proofs', '[]'))
        except Exception:
            removed_urls = []

        for target_url in removed_urls:
            if target_url in current_proofs:
                if not delete_r2_file(target_url):
                    return jsonify({"error": "Failed to delete an existing proof file. Please try again."}), 502
                current_proofs.remove(target_url)

        uploaded_files = request.files.getlist('proof_files')
        new_uploads_tracked = []
        # Continue numbering from the existing proof list so each upload gets a
        # unique object key within the same module folder.
        start_index = len(current_proofs) + 1
        for i, file_obj in enumerate(uploaded_files):
            if file_obj and file_obj.filename != '':
                ext = file_obj.filename.rsplit('.', 1)[-1] if '.' in file_obj.filename else 'bin'
                object_key = (
                    f"{folder_path}/{sanitize_path_segment('proof' + str(start_index + i))}"
                    f"_{sanitize_path_segment(cust.customer_id)}.{ext}"
                )
                try:
                    new_url = upload_to_r2(file_obj, object_key, content_type=file_obj.mimetype)
                except Exception:
                    return jsonify({"error": "Failed to upload one of the proof files. Please try again."}), 502
                current_proofs.append(new_url)
                new_uploads_tracked.append(new_url)

        if new_uploads_tracked or removed_urls:
            changes['proof_files'] = {"added": new_uploads_tracked, "removed": removed_urls}

        payment.proof_file = json.dumps(current_proofs)

        is_settled = abs(payment.due_amount) < DUE_AMOUNT_EPSILON
        old_work_done = payment.work_done
        if (is_settled and float(payment.advance_amount or 0) > 0
                and float(payment.second_payment or 0) > 0
                and payment.proof_file and len(current_proofs) > 0):
            payment.work_done = 'Completed'
        else:
            payment.work_done = 'Pending'
        if old_work_done != payment.work_done:
            changes['work_done'] = {"old": old_work_done, "new": payment.work_done}

        payment.updated_by = uid
        payment.updated_at = datetime.utcnow()

        if changes or action == "CREATE":
            log = CustomerAuditLog(
                customer_project_id=cust.id,
                user_id=uid,
                action=action,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {"initialized": True}),
            )
            db.session.add(log)

        db.session.commit()
        return jsonify({"message": "Payment records saved successfully", "payment": payment.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Save failed: {str(e)}"}), 500