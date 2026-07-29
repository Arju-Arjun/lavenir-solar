from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from collections import Counter
import json

from models import (
    db, User, CustomerProject, SiteVisit, MNREProfile, BankLoan, Payment,
    KSEB, KsebRegistrationCompletion, DCRCertificate, MNREInstallation, Service
)

workflow_bp = Blueprint('workflow_bp', __name__)


def _module_result(title, is_done, pending_labels):
    """
    Shared shape for every "single record, work_done-based" module:
    {title, status: Completed/Pending, pending: [labels]}
    Mirrors exactly the same boolean logic each module's own blueprint uses
    to set `.work_done`, so this endpoint can never disagree with what the
    module's own save route decided.
    """
    return {
        "title": title,
        "status": "Completed" if is_done else "Pending",
        "pending": [] if is_done else pending_labels
    }


def _load_json_list(raw):
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


@workflow_bp.route('/<string:customer_id>/', methods=['GET'])
@jwt_required()
def get_workflow_status(customer_id):
    uid = get_jwt_identity()
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "Context Error"}), 401

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"error": "Customer project record not found."}), 404

    result = {}

    # ---------------- Site Visit ----------------
    visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
    if not visit:
        result['site_visit'] = _module_result('Site Visit', False, ['Site visit not started'])
    else:
        pending = []
        if not (visit.panel_capacity and visit.panel_capacity > 0): pending.append('Panel Capacity')
        if not (visit.system_capacity and visit.system_capacity > 0): pending.append('System Capacity')
        if visit.feasibility != 'Yes': pending.append('Feasibility (Yes)')
        if not (visit.project_cost and visit.project_cost > 0): pending.append('Project Cost')
        if not visit.location: pending.append('Location')
        if not visit.quotation_file: pending.append('Quotation')
        if not visit.agreement_file: pending.append('Agreement')
        if not visit.aadhaar: pending.append('Aadhaar')
        if not visit.pan: pending.append('PAN')
        if not visit.kseb_bill: pending.append('KSEB Bill')
        if not visit.bank_passbook: pending.append('Bank Passbook')
        if not visit.land_tax: pending.append('Land Tax')
        if not visit.building_tax: pending.append('Building Tax')
        if not visit.signature: pending.append('Signature')
        result['site_visit'] = _module_result('Site Visit', len(pending) == 0, pending)

    # ---------------- MNRE Profile ----------------
    mnre_profile = MNREProfile.query.filter_by(customer_project_id=customer.id).first()
    if not mnre_profile:
        result['mnre_profile'] = _module_result('MNRE Profile', False, ['Not started'])
    else:
        pending = []
        if mnre_profile.mnre_status != 'Completed': pending.append('MNRE Status')
        if not mnre_profile.feasibility_file: pending.append('Feasibility File')
        if not mnre_profile.ack_file: pending.append('Acknowledgement File')
        result['mnre_profile'] = _module_result('MNRE Profile', len(pending) == 0, pending)

    # ---------------- Bank Loan ----------------
    loan = BankLoan.query.filter_by(customer_project_id=customer.id).first()
    if not loan:
        result['bank_loan'] = _module_result('Bank Loan', False, ['Not started'])
    elif not loan.need_loan:
        # Loan not required -> vacuously complete, matches bank_loan.py's own rule
        result['bank_loan'] = _module_result('Bank Loan', True, [])
    else:
        pending = []
        if loan.jansamarth_status != 'Completed': pending.append('Jansamarth Status')
        if loan.document_submission not in ['By Hand', 'Mail', 'By Hand and Mail']:
            pending.append('Document Submission')
        has_positive_payments = float(loan.total_approved_loan_amount or 0) > 0 and float(loan.due_amount or 0) == 0
        if not has_positive_payments: pending.append('Loan Amount Fully Disbursed')
        if not loan.acknowledgement_file: pending.append('Acknowledgement File')
        result['bank_loan'] = _module_result('Bank Loan', len(pending) == 0, pending)

    # ---------------- Payment Flow ----------------
    payment = Payment.query.filter_by(customer_project_id=customer.id).first()
    if not payment:
        result['payment'] = _module_result('Payment Flow', False, ['Not started'])
    else:
        pending = []
        if float(payment.due_amount or 0) != 0.0: pending.append('Due Amount Not Cleared')
        if not (payment.advance_amount and float(payment.advance_amount) > 0): pending.append('Advance Amount')
        if not (payment.second_payment and float(payment.second_payment) > 0): pending.append('Second Payment')
        if len(_load_json_list(payment.proof_file)) == 0: pending.append('Payment Proof')
        result['payment'] = _module_result('Payment Flow', len(pending) == 0, pending)

    # ---------------- KSEB Utility ----------------
    kseb_data = KSEB.query.filter_by(customer_project_id=customer.id).first()
    if not kseb_data:
        result['kseb'] = _module_result('KSEB Utility', False, ['Not started'])
    else:
        pending = []
        if visit and visit.ownership_change == 'Yes' and kseb_data.ownership_status != 'Complete':
            pending.append('Ownership Change Status')
        if visit and visit.load_enhancement == 'Yes' and kseb_data.load_enhancement_status != 'Complete':
            pending.append('Load Enhancement Status')
        if not kseb_data.fee_paid: pending.append('Fee Paid')
        if kseb_data.feasibility_status != 'Complete': pending.append('Feasibility Status')
        result['kseb'] = _module_result('KSEB Utility', len(pending) == 0, pending)

    # ---------------- KSEB Registration & Completion ----------------
    reg = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer.id).first()
    if not reg:
        result['kseb_registration'] = _module_result('KSEB Registration & Completion', False, ['Not started'])
    else:
        pending = []
        if not reg.registration_submitted: pending.append('Registration Submitted')
        if not reg.completion_submitted: pending.append('Completion Submitted')
        if not reg.agreement_submitted: pending.append('Agreement Submitted')
        if not reg.payment_done: pending.append('Payment Done')
        if not reg.plant_energized: pending.append('Plant Energized')
        wifi_required = bool(visit and (visit.wifi == True or str(visit.wifi).strip().lower() == 'yes'))
        if wifi_required and not reg.wifi_configured: pending.append('Wifi Configured')
        result['kseb_registration'] = _module_result('KSEB Registration & Completion', len(pending) == 0, pending)

    # ---------------- DCR Details ----------------
    dcr = DCRCertificate.query.filter_by(customer_project_id=customer.id).first()
    if not dcr:
        result['dcr'] = _module_result('DCR Details', False, ['Not started'])
    else:
        pending = []
        if not dcr.certificate_received: pending.append('Certificate Received')
        if not dcr.certificate_file: pending.append('Certificate File')
        result['dcr'] = _module_result('DCR Details', len(pending) == 0, pending)

    # ---------------- Material Delivery ----------------
    delivery = customer.material_delivery_rel
    if not delivery:
        result['material_delivery'] = _module_result('Material Delivery', False, ['Not started'])
    else:
        pending = []
        if not delivery.electrical_delivered: pending.append('Electrical Delivered')
        if not delivery.structure_delivered: pending.append('Structure Delivered')
        if not delivery.panel_delivered: pending.append('Panel Delivered')
        if len(_load_json_list(delivery.delivery_images)) == 0: pending.append('Delivery Images')
        result['material_delivery'] = _module_result('Material Delivery', len(pending) == 0, pending)

    # ---------------- Installation Progress (Material Installation) ----------------
    installation = customer.material_installation_rel
    if not installation:
        result['material_installation'] = _module_result('Installation Progress', False, ['Not started'])
    else:
        pending = []
        if not installation.electrical_installed: pending.append('Electrical Installed')
        if not installation.structure_installed: pending.append('Structure Installed')
        if len(_load_json_list(installation.installation_images)) == 0: pending.append('Installation Images')
        result['material_installation'] = _module_result('Installation Progress', len(pending) == 0, pending)

    # ---------------- MNRE Installation ----------------
    mnre_install = MNREInstallation.query.filter_by(customer_project_id=customer.id).first()
    if not mnre_install:
        result['mnre_installation'] = _module_result('MNRE Installation', False, ['Not started'])
    else:
        pending = []
        if mnre_install.installation_status != 'Completed': pending.append('Installation Status')
        if mnre_install.approval_status != 'Approved': pending.append('Approval Status')
        if mnre_install.subsidy_status != 'Received': pending.append('Subsidy Status')
        result['mnre_installation'] = _module_result('MNRE Installation', len(pending) == 0, pending)

    # ---------------- Service (NOT work_done-based — ongoing log) ----------------
    # Service records repeat indefinitely (Maintenance visit #1, #2, Repair
    # visit #1, ...), so "Completed/Pending" doesn't apply here. Instead we
    # show how many service entries exist, broken down by service_type.
    services = Service.query.filter_by(customer_project_id=customer.id).all()
    type_counts = Counter()
    for s in services:
        stype = (s.service_type or 'Unspecified').strip()
        type_counts[stype] += 1

    result['service'] = {
        "title": "Service",
        "type": "count",          # tells the frontend to render this node differently
        "total": len(services),
        "counts": dict(type_counts)   # e.g. {"Maintenance": 3, "Repair": 2}
    }

    return jsonify({"workflow": result}), 200