import json
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required
from models import (
    db,
    CustomerProject,
    SiteVisit,
    MNREProfile,
    MNREInstallation,
    BankLoan,
    Payment,
    KSEB,
    KsebRegistrationCompletion,
    DCRCertificate,
    Service,
    MaterialDelivery,
    MaterialInstallation,
)

documents_bp = Blueprint('documents', __name__)


def _file_entry(url, name):
    """Build a single { url, name } document entry, or None if there's no file."""
    if not url:
        return None
    return {"url": url, "name": name}


def _parse_json_list(raw):
    """Safely parse a JSON-text column that is expected to hold a list of file urls."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        return []
    except Exception:
        return []


def _gallery_entries(raw, label_prefix):
    """Turn a JSON array column (e.g. images) into a list of named file entries."""
    entries = []
    for idx, url in enumerate(_parse_json_list(raw), start=1):
        entry = _file_entry(url, f"{label_prefix} {idx}")
        if entry:
            entries.append(entry)
    return entries


@documents_bp.route('/customers', methods=['GET'])
@jwt_required()
def get_all_customers_for_docs():
    """Fetch all customer projects for the document vault."""
    try:
        customers = CustomerProject.query.order_by(CustomerProject.id.asc()).all()
        return jsonify([c.to_dict() for c in customers]), 200
    except Exception as err:
        return jsonify({"error": str(err)}), 500


@documents_bp.route('/<int:customer_id>/documents', methods=['GET'])
@jwt_required()
def get_customer_documents(customer_id):
    customer = CustomerProject.query.get(customer_id)
    if not customer:
        return jsonify({"error": "Customer not found"}), 404

    result = {}

    # --- Profile ---
    profile_files = []
    entry = _file_entry(customer.profile_photo, "Profile Photo")
    if entry:
        profile_files.append(entry)
    if profile_files:
        result["profile"] = profile_files

    # --- Site Visit (one-to-many) ---
    site_visit_files = []
    site_visits = SiteVisit.query.filter_by(customer_project_id=customer_id).order_by(SiteVisit.created_at.asc()).all()
    for i, sv in enumerate(site_visits, start=1):
        suffix = f" #{i}" if len(site_visits) > 1 else ""
        for value, label in [
            (sv.quotation_file, f"Quotation{suffix}"),
            (sv.agreement_file, f"Agreement{suffix}"),
            (sv.aadhaar, f"Aadhaar{suffix}"),
            (sv.pan, f"PAN{suffix}"),
            (sv.kseb_bill, f"KSEB Bill{suffix}"),
            (sv.bank_passbook, f"Bank Passbook{suffix}"),
            (sv.land_tax, f"Land Tax{suffix}"),
            (sv.building_tax, f"Building Tax{suffix}"),
            (sv.signature, f"Signature{suffix}"),
        ]:
            entry = _file_entry(value, label)
            if entry:
                site_visit_files.append(entry)
        site_visit_files.extend(_gallery_entries(sv.images, f"Site Photo{suffix}"))
    if site_visit_files:
        result["site_visit"] = site_visit_files

    # --- MNRE Profile (one-to-one) ---
    mnre_profile_files = []
    mnre_profile = MNREProfile.query.filter_by(customer_project_id=customer_id).first()
    if mnre_profile:
        for value, label in [
            (mnre_profile.feasibility_file, "Feasibility File"),
            (mnre_profile.ack_file, "Acknowledgement File"),
        ]:
            entry = _file_entry(value, label)
            if entry:
                mnre_profile_files.append(entry)
    if mnre_profile_files:
        result["mnre_profile"] = mnre_profile_files

    # --- MNRE Installation ---
    _ = MNREInstallation.query.filter_by(customer_project_id=customer_id).first()

    # --- Bank Loan (one-to-one) ---
    bank_loan_files = []
    bank_loan = BankLoan.query.filter_by(customer_project_id=customer_id).first()
    if bank_loan:
        entry = _file_entry(bank_loan.acknowledgement_file, "Loan Acknowledgement")
        if entry:
            bank_loan_files.append(entry)
    if bank_loan_files:
        result["bank_loan"] = bank_loan_files

    # --- Payment (one-to-one) ---
    payment_files = []
    payment = Payment.query.filter_by(customer_project_id=customer_id).first()
    if payment:
        raw_proof = payment.proof_file
        parsed_proof = _parse_json_list(raw_proof)
        if parsed_proof:
            payment_files.extend(_gallery_entries(raw_proof, "Payment Proof"))
        else:
            entry = _file_entry(raw_proof, "Payment Proof")
            if entry:
                payment_files.append(entry)
    if payment_files:
        result["payment"] = payment_files

    # --- KSEB ---
    _ = KSEB.query.filter_by(customer_project_id=customer_id).first()

    # --- KSEB Registration & Completion ---
    _ = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer_id).first()

    # --- DCR Certificate (one-to-one) ---
    dcr_files = []
    dcr = DCRCertificate.query.filter_by(customer_project_id=customer_id).first()
    if dcr:
        entry = _file_entry(dcr.certificate_file, "DCR Certificate")
        if entry:
            dcr_files.append(entry)
    if dcr_files:
        result["dcr"] = dcr_files

    # --- Service records (one-to-many) ---
    service_files = []
    services = Service.query.filter_by(customer_project_id=customer_id).order_by(Service.service_number.asc()).all()
    for svc in services:
        service_files.extend(_gallery_entries(svc.images, f"Service #{svc.service_number} Photo"))
    if service_files:
        result["service"] = service_files

    # --- Material Delivery (one-to-many) ---
    material_delivery_files = []
    deliveries = MaterialDelivery.query.filter_by(customer_project_id=customer_id).order_by(MaterialDelivery.created_at.asc()).all()
    for i, md in enumerate(deliveries, start=1):
        suffix = f" #{i}" if len(deliveries) > 1 else ""
        entry_list = _gallery_entries(md.delivery_document, f"Delivery Document{suffix}")
        material_delivery_files.extend(entry_list)
        material_delivery_files.extend(_gallery_entries(md.delivery_images, f"Delivery Photo{suffix}"))
    if material_delivery_files:
        result["material_delivery"] = material_delivery_files

    # --- Material Installation (one-to-many) ---
    material_installation_files = []
    installations = MaterialInstallation.query.filter_by(customer_project_id=customer_id).order_by(MaterialInstallation.created_at.asc()).all()
    for i, mi in enumerate(installations, start=1):
        suffix = f" #{i}" if len(installations) > 1 else ""
        entry = _file_entry(mi.installation_document, f"Installation Document{suffix}")
        if entry:
            material_installation_files.append(entry)
        material_installation_files.extend(_gallery_entries(mi.installation_images, f"Installation Photo{suffix}"))
    if material_installation_files:
        result["material_installation"] = material_installation_files

    return jsonify(result), 200