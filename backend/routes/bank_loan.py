from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, CustomerProject, MNREProfile, BankLoan, CustomerAuditLog
from utils import (
    check_permission, 
    delete_cloudinary_file, 
    handle_blueprint_check_access, 
    handle_blueprint_request_access,
    get_module_folder_path,
    sanitize_path_segment
)
from datetime import datetime
from decimal import Decimal
import cloudinary
import cloudinary.uploader
import json

bank_loan_bp = Blueprint('bank_loan_bp', __name__)

# Standard Matrix Key Name synchronized with Frontend systemModules
MODULE_NAME = 'Bank Loan'
# Folder segment used in the storage path (kept separate from MODULE_NAME
# above, which is used for the permissions matrix and audit logs).
FOLDER_MODULE_NAME = 'bankloan'


# Below this, a loan's due_amount is treated as "fully settled" - money math
# on floats rarely lands on an exact 0.0, so an equality check would
# silently never mark a fully-paid loan as Completed.
DUE_AMOUNT_EPSILON = 0.01


def _json_default(obj):
    """
    FIX: json.dumps(changes) was crashing with "Object of type Decimal is
    not JSON serializable" whenever a raw Decimal value (straight from a
    SQLAlchemy Numeric column, e.g. total_approved_loan_amount, due_amount)
    ended up in the audit-log changes dict unconverted. Passed as
    json.dumps(..., default=_json_default), this is a safety net that
    coerces any Decimal/datetime that slips through — belt and suspenders
    alongside explicitly casting to float at the point each value is read.
    """
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


@bank_loan_bp.route('/check-access/', methods=['GET'])
@jwt_required()
def check_access():
    uid = get_jwt_identity()
    # Automatically pulls view/update permissions and active pending requests via utils.py
    return handle_blueprint_check_access(uid, MODULE_NAME)


@bank_loan_bp.route('/request-access/', methods=['POST'])
@jwt_required()
def request_module_access():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    return handle_blueprint_request_access(uid, MODULE_NAME, data)


@bank_loan_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_bank_loan(customer_id):
    try:
        uid = get_jwt_identity()
        user = User.query.get(uid)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'

        if not is_admin and not check_permission(uid, 'view', MODULE_NAME):
            return jsonify({"error": "Unauthorized View clearance matrix level missing."}), 403

        cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not cust:
            return jsonify({"profile": None, "message": "Customer project record could not be resolved."}), 404

        mnre = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
        mnre_status = mnre.mnre_status if mnre else "Pending"

        loan = BankLoan.query.filter_by(customer_project_id=cust.id).first()

        return jsonify({
            "loan": loan.to_dict() if loan else None,
            "mnre_status": mnre_status
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bank_loan_bp.route('/<string:customer_id>/', methods=['POST'])
@jwt_required()
def save_bank_loan(customer_id):
    try:
        uid = get_jwt_identity()
        user = User.query.get(uid)
        if not user:
            return jsonify({"error": "Operator profile missing"}), 404
        is_admin = user.role and user.role.strip().lower() == 'admin'

        cust = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not cust:
            return jsonify({"error": "Customer project record could not be resolved."}), 404

        # Centralized storage folder for this customer + module, e.g.:
        # lavenir/JohnDoe_1023/bankloan
        folder_path = get_module_folder_path(cust.customer_name, cust.customer_id, FOLDER_MODULE_NAME)

        # Permission check runs ahead of the MNRE-status check so a user
        # with no update permission on Bank Loan never learns the
        # customer's MNRE completion status before being told they lack
        # access — permission gates everything else, not the other way
        # around.
        if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
            return jsonify({"error": "Administrative block: Security matrix context lacks required write clearance parameters."}), 403

        mnre = MNREProfile.query.filter_by(customer_project_id=cust.id).first()
        if not is_admin and (not mnre or mnre.mnre_status != "Completed"):
            return jsonify({"error": "Modifications blocked: MNRE verification status is not 'Completed'."}), 403

        loan = BankLoan.query.filter_by(customer_project_id=cust.id).first()

        # Resolve the requested need_loan value up front — before deciding
        # whether to create/update a row at all — since that decision now
        # branches into two completely different code paths below.
        if 'need_loan' in request.form:
            new_need_loan = request.form.get('need_loan') == 'true'
        else:
            new_need_loan = loan.need_loan if loan else True

        # ------------------------------------------------------------------
        # Loan not required -> clear all of its data and mark the module
        # Completed, but keep the row itself (see loan.work_done line
        # below) so other queries that look for a BankLoan.work_done value
        # per project still see this module as done rather than missing.
        # ------------------------------------------------------------------
        if not new_need_loan:
            action = "UPDATE" if loan else "CREATE"
            if not loan:
                loan = BankLoan(customer_project_id=cust.id, created_by=uid)
                db.session.add(loan)

            changes = {}
            old_need_loan = loan.need_loan
            loan.need_loan = False
            if old_need_loan != False:
                changes['need_loan'] = {"old": old_need_loan, "new": False}

            # Clear all the loan's data (this IS the "delete full bank loan
            # data" behavior) but keep the row itself, since other queries
            # (e.g. the admin project-status aggregate) look for a
            # BankLoan.work_done value per project — deleting the row
            # entirely made those wrongly count this module as incomplete.
            reset_values = {
                'jansamarth_status': 'Pending',
                'document_submission': None,
                'comment': "",
                'loan_payments': '[]',
                'total_loan_amount': 0.00,
                'total_approved_loan_amount': 0.00,
                'due_amount': 0.00,
            }
            for field, new_val in reset_values.items():
                old_val = getattr(loan, field)
                # FIX for the Decimal crash: cast before it goes into
                # `changes` — json.dumps() can't serialize a raw Decimal.
                old_val_safe = float(old_val) if isinstance(old_val, Decimal) else old_val
                if old_val_safe != new_val:
                    changes[field] = {"old": old_val_safe, "new": new_val}
                setattr(loan, field, new_val)

            if loan.acknowledgement_file:
                old_file_url = loan.acknowledgement_file
                delete_cloudinary_file(old_file_url, folder_path)
                changes['acknowledgement_file'] = {"old": old_file_url, "new": None}
                loan.acknowledgement_file = None

            # <<< the line you asked for >>>
            # A loan that isn't needed has nothing left to complete, so
            # this module counts as done for aggregate/project-status
            # reporting instead of showing up as perpetually pending.
            loan.work_done = 'Completed'

            loan.updated_by = uid
            loan.updated_at = datetime.utcnow()

            if changes or action == "CREATE":
                log = CustomerAuditLog(
                    customer_project_id=cust.id,
                    user_id=uid,
                    action=action,
                    module_name=MODULE_NAME,
                    changes_payload=json.dumps(changes if changes else {"initialized": True}, default=_json_default)
                )
                db.session.add(log)

            db.session.commit()
            return jsonify({
                "message": "Bank loan marked as not required — existing loan data cleared.",
                "loan": loan.to_dict()
            }), 200

        # ------------------------------------------------------------------
        # From here on, need_loan is True: normal create/update flow.
        # ------------------------------------------------------------------
        action = "UPDATE" if loan else "CREATE"
        if not loan:
            loan = BankLoan(customer_project_id=cust.id, created_by=uid)
            db.session.add(loan)

        changes = {}

        if loan.need_loan != True:
            changes['need_loan'] = {"old": loan.need_loan, "new": True}
        loan.need_loan = True

        if 'jansamarth_status' in request.form:
            old_js = loan.jansamarth_status
            loan.jansamarth_status = request.form.get('jansamarth_status')
            if old_js != loan.jansamarth_status:
                changes['jansamarth_status'] = {"old": old_js, "new": loan.jansamarth_status}

        if 'document_submission' in request.form:
            old_ds = loan.document_submission
            loan.document_submission = request.form.get('document_submission') or None
            if old_ds != loan.document_submission:
                changes['document_submission'] = {"old": old_ds, "new": loan.document_submission}

        if 'comment' in request.form:
            old_comment = loan.comment
            loan.comment = request.form.get('comment')
            if old_comment != loan.comment:
                changes['comment'] = {"old": old_comment, "new": loan.comment}

        if 'total_approved_loan_amount' in request.form:
            old_approved_amt = loan.total_approved_loan_amount
            raw_approved_amt = request.form.get('total_approved_loan_amount')

            try:
                # Handle empty strings or None gracefully by defaulting to 0.0
                if raw_approved_amt is None or str(raw_approved_amt).strip() == '':
                    new_approved_amt = 0.0
                else:
                    new_approved_amt = float(raw_approved_amt)
            except ValueError:
                return jsonify({"error": "Invalid total approved loan amount. Must be a numeric value."}), 400

            if new_approved_amt < 0:
                return jsonify({"error": "total_approved_loan_amount cannot be negative."}), 400

            loan.total_approved_loan_amount = new_approved_amt
            if old_approved_amt != loan.total_approved_loan_amount:
                changes['total_approved_loan_amount'] = {"old": float(old_approved_amt or 0), "new": float(loan.total_approved_loan_amount)}

        if 'loan_payments' in request.form:
            old_payments = loan.loan_payments

            # Malformed JSON, a non-list payload, or a non-numeric `amount`
            # field is validated explicitly here and returned as a clean
            # 400, rather than falling through to the generic 500 below.
            try:
                payments_data = json.loads(request.form.get('loan_payments') or '[]')
                if not isinstance(payments_data, list):
                    raise ValueError("loan_payments must be a JSON array")
                amounts = [float(p.get('amount', 0)) for p in payments_data]
                if any(a < 0 for a in amounts):
                    raise ValueError("payment amounts cannot be negative")
                total_amt = sum(amounts)
            except (ValueError, TypeError, AttributeError):
                return jsonify({"error": "Invalid loan_payments payload. Expected a JSON array of {label, amount} objects with non-negative amounts."}), 400

            loan.loan_payments = json.dumps(payments_data)
            loan.total_loan_amount = total_amt
            if old_payments != loan.loan_payments:
                changes['loan_payments'] = {"old": old_payments, "new": payments_data}

        if 'acknowledgement_file' in request.files:
            file_obj = request.files['acknowledgement_file']
            if file_obj and file_obj.filename != '':
                # Upload the replacement first and only delete the old file
                # once the new one is confirmed on Cloudinary, so a failed
                # upload never leaves the customer with no file at all.
                old_file_url = loan.acknowledgement_file
                # public_id -> "{doctype}_{customer_id}" (Cloudinary appends the
                # extension automatically), giving lavenir/{customer}_{id}/bankloan/{doctype}_{id}.{ext}
                public_id = f"{sanitize_path_segment('acknowledgement_file')}_{sanitize_path_segment(cust.customer_id)}"
                res = cloudinary.uploader.upload(
                    file_obj, folder=folder_path, public_id=public_id, overwrite=True
                )
                if old_file_url:
                    delete_cloudinary_file(old_file_url, folder_path)
                changes['acknowledgement_file'] = {"old": old_file_url, "new": res['secure_url']}
                loan.acknowledgement_file = res['secure_url']

        # Recalculate due amount after potential updates to totals
        loan.due_amount = float(loan.total_approved_loan_amount or 0) - float(loan.total_loan_amount or 0)

        is_work_done = False
        has_positive_payments = float(loan.total_approved_loan_amount or 0) > 0 and abs(float(loan.due_amount or 0)) < DUE_AMOUNT_EPSILON
        if (loan.jansamarth_status == 'Completed' and
            loan.document_submission in ['By Hand', 'Mail', 'By Hand and Mail'] and
            has_positive_payments and
            loan.acknowledgement_file):
            is_work_done = True

        loan.work_done = 'Completed' if is_work_done else 'Pending'
        loan.updated_by = uid
        loan.updated_at = datetime.utcnow()

        if changes or action == "CREATE":
            log = CustomerAuditLog(
                customer_project_id=cust.id,
                user_id=uid,
                action=action,
                module_name=MODULE_NAME,
                changes_payload=json.dumps(changes if changes else {"initialized": True}, default=_json_default)
            )
            db.session.add(log)

        db.session.commit()
        return jsonify({"message": "Operational parameters tracked successfully", "loan": loan.to_dict()}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Save failed: {str(e)}"}), 500