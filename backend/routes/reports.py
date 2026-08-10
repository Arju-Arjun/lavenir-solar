"""
Customer Report + Staff Performance Report generation, powered by Gemini.

Two endpoints:
  POST /api/reports/customer/<customer_id>
      -> aggregates the 11 workflow modules for that customer and asks
         Gemini for a complete project-status report (plain text).

  POST /api/reports/staff/<user_id>
      -> aggregates that staff member's activity within a date window
         and asks Gemini for a performance report (plain text).

Both endpoints are admin-only for now (reports span every customer/staff
member's data, so this isn't gated behind the per-module permission matrix
used elsewhere - adjust check_admin_only() below if you want finer-grained
access later, e.g. a dedicated 'Reports' entry in the permissions matrix).
"""

from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from models import (
    db, User, CustomerProject, CustomerAuditLog,
    SiteVisit, MNREProfile, MNREInstallation, Payment, BankLoan, KSEB,
    KsebRegistrationCompletion, DCRCertificate, MaterialDelivery,
    MaterialDeliveryItem, MaterialInstallation, Service, Complaint,
    ComplaintAssignee,
)
from utils import serialize_model, generate_gemini_report

reports_bp = Blueprint('reports', __name__)


def check_admin_only():
    """Returns (user, error_response). error_response is None if OK."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return None, (jsonify({"success": False, "message": "Operator profile missing"}), 404)
    if not user.role or user.role.strip().lower() != 'admin':
        return None, (jsonify({"success": False, "message": "Reports are admin-only for now."}), 403)
    return user, None


# ---------------------------------------------------------------------------
# SEARCH ENDPOINTS (power the dropdown/search selectors on the Reports page)
# ---------------------------------------------------------------------------

@reports_bp.route('/customers/search', methods=['GET'])
@jwt_required()
def search_customers():
    _, err = check_admin_only()
    if err:
        return err

    q = (request.args.get('q') or '').strip()

    query = CustomerProject.query
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(
                CustomerProject.customer_id.ilike(like),
                CustomerProject.customer_name.ilike(like),
                CustomerProject.phone_number.ilike(like),
            )
        )

    customers = query.order_by(CustomerProject.customer_name.asc()).limit(25).all()

    return jsonify({
        "success": True,
        "customers": [
            {
                "customer_id": c.customer_id,
                "customer_name": c.customer_name,
                "phone_number": c.phone_number,
                "place": c.place,
                "district": c.district,
            }
            for c in customers
        ],
    }), 200


@reports_bp.route('/staff/search', methods=['GET'])
@jwt_required()
def search_staff():
    _, err = check_admin_only()
    if err:
        return err

    q = (request.args.get('q') or '').strip()

    # Staff performance reports are about staff, not admins reviewing
    # themselves, so admins are excluded from this list by default.
    query = User.query.filter(db.func.lower(User.role) != 'admin')
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(
                User.full_name.ilike(like),
                User.employee_id.ilike(like),
                User.email.ilike(like),
            )
        )

    staff = query.order_by(User.full_name.asc()).limit(25).all()

    return jsonify({
        "success": True,
        "staff": [
            {
                "id": s.id,
                "full_name": s.full_name,
                "employee_id": s.employee_id,
                "department": s.department,
                "role": s.role,
            }
            for s in staff
        ],
    }), 200


# ---------------------------------------------------------------------------
# CUSTOMER REPORT
# ---------------------------------------------------------------------------

def _build_customer_report_data(customer):
    """Pulls together the 11 workflow modules for one customer, plus
    complaints and audit-log history so the report reflects everything on
    record for this customer, not just the 11 module tables."""

    latest_site_visit = (
        SiteVisit.query.filter_by(customer_project_id=customer.id)
        .order_by(SiteVisit.created_at.desc()).first()
    )
    # A customer can have more than one KSEB record over time (e.g. a
    # feasibility re-check after a load enhancement) - report on the full
    # history, not just the latest one, so nothing is silently dropped.
    kseb_records = (
        KSEB.query.filter_by(customer_project_id=customer.id)
        .order_by(KSEB.created_at.desc()).all()
    )
    services = (
        Service.query.filter_by(customer_project_id=customer.id)
        .order_by(Service.service_number.asc()).all()
    )
    complaints = (
        Complaint.query.filter_by(customer_project_id=customer.id)
        .order_by(Complaint.created_at.desc()).all()
    )
    audit_logs = (
        CustomerAuditLog.query.filter_by(customer_project_id=customer.id)
        .order_by(CustomerAuditLog.timestamp.desc())
        .limit(50)  # most recent 50 - full history can be very long
        .all()
    )

    material_items = []
    if customer.material_delivery_rel:
        material_items = MaterialDeliveryItem.query.filter_by(
            material_delivery_id=customer.material_delivery_rel.id
        ).all()

    return {
        "customer_profile": customer.to_dict(),

        # 1. Site Visit
        "site_visit": serialize_model(latest_site_visit),
        # 2. MNRE Profile
        "mnre_profile": serialize_model(customer.mnre_profile_rel),
        # 3. Payment Flow
        "payment_flow": serialize_model(customer.payment_rel),
        # 4. Bank Loan
        "bank_loan": serialize_model(customer.bank_loan_rel),
        # 5. KSEB Feasibility (full history - a customer can have more than one)
        "kseb_feasibility": [serialize_model(k) for k in kseb_records],
        # 6. Material Delivery
        "material_delivery": serialize_model(customer.material_delivery_rel),
        "material_delivery_items": [serialize_model(i) for i in material_items],
        # 7. (Material) Installation
        "material_installation": serialize_model(customer.material_installation_rel),
        # 8. KSEB Registration & Completion
        "kseb_registration_completion": serialize_model(customer.kseb_registration_rel),
        # 9. DCR
        "dcr_certificate": serialize_model(customer.dcr_certificate_rel),
        # 10. MNRE Installation
        "mnre_installation": serialize_model(customer.mnre_installation_rel),
        # 11. Service & Maintenance
        "services": [serialize_model(s) for s in services],

        # Extra context beyond the 11 modules - complaint history and a
        # recent activity trail, so the report reflects everything on file
        # for this customer.
        "complaints": [c.to_dict() for c in complaints],
        "recent_activity_log": [log.to_dict() for log in audit_logs],
    }


@reports_bp.route('/customer/<string:customer_id>', methods=['POST'])
@jwt_required()
def generate_customer_report(customer_id):
    _, err = check_admin_only()
    if err:
        return err

    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"success": False, "message": "Customer not found"}), 404

    payload = request.get_json(silent=True) or {}
    language = payload.get('language', 'english')

    try:
        report_data = _build_customer_report_data(customer)
        report_text = generate_gemini_report(report_data, report_type='customer', language=language)
        return jsonify({
            "success": True,
            "customer_id": customer.customer_id,
            "customer_name": customer.customer_name,
            "report": report_text,
            "language": language,
            "generated_at": datetime.utcnow().isoformat(),
        }), 200
    except RuntimeError as e:
        # e.g. GEMINI_API_KEY missing
        return jsonify({"success": False, "message": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "message": f"Report generation failed: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# STAFF PERFORMANCE REPORT
# ---------------------------------------------------------------------------

def _resolve_date_range(payload):
    """
    payload can specify:
      { "period": "last_week" }
      { "period": "last_month" }
      { "period": "custom", "start_date": "2026-07-01", "end_date": "2026-07-31" }
    Returns (start_datetime, end_datetime) or raises ValueError.
    """
    period = (payload or {}).get('period', 'last_week')
    end_date = datetime.utcnow()

    if period == 'last_week':
        start_date = end_date - timedelta(days=7)
    elif period == 'last_month':
        start_date = end_date - timedelta(days=30)
    elif period == 'custom':
        start_raw = (payload or {}).get('start_date')
        end_raw = (payload or {}).get('end_date')
        if not start_raw or not end_raw:
            raise ValueError("Custom range requires both start_date and end_date.")
        start_date = datetime.fromisoformat(start_raw)
        # include the whole end day
        end_date = datetime.fromisoformat(end_raw) + timedelta(days=1, microseconds=-1)
    else:
        raise ValueError(f"Unknown period: {period}")

    if start_date > end_date:
        raise ValueError("start_date must be before end_date.")

    return start_date, end_date


def _build_staff_report_data(staff_user, start_date, end_date):
    audit_logs = (
        CustomerAuditLog.query
        .filter(
            CustomerAuditLog.user_id == staff_user.id,
            CustomerAuditLog.timestamp >= start_date,
            CustomerAuditLog.timestamp <= end_date,
        )
        .order_by(CustomerAuditLog.timestamp.asc())
        .all()
    )

    site_visits_logged = (
        SiteVisit.query
        .filter(
            db.or_(SiteVisit.created_by == staff_user.id, SiteVisit.updated_by == staff_user.id),
            SiteVisit.created_at >= start_date,
            SiteVisit.created_at <= end_date,
        )
        .all()
    )

    complaints_assigned = (
        Complaint.query
        .join(ComplaintAssignee, ComplaintAssignee.complaint_id == Complaint.id)
        .filter(
            ComplaintAssignee.user_id == staff_user.id,
            Complaint.created_at >= start_date,
            Complaint.created_at <= end_date,
        )
        .all()
    )

    complaints_resolved = [
        c for c in complaints_assigned
        if c.resolved_at and start_date <= c.resolved_at <= end_date
    ]

    return {
        "staff_profile": staff_user.to_dict(),
        "period": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "activity_log": [log.to_dict() for log in audit_logs],
        "site_visits_logged": [serialize_model(sv) for sv in site_visits_logged],
        "complaints_assigned": [c.to_dict() for c in complaints_assigned],
        "complaints_resolved": [c.to_dict() for c in complaints_resolved],
    }


@reports_bp.route('/staff/<int:user_id>', methods=['POST'])
@jwt_required()
def generate_staff_report(user_id):
    _, err = check_admin_only()
    if err:
        return err

    staff_user = User.query.get(user_id)
    if not staff_user:
        return jsonify({"success": False, "message": "Staff member not found"}), 404

    payload = request.get_json(silent=True) or {}

    try:
        start_date, end_date = _resolve_date_range(payload)
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    language = payload.get('language', 'english')

    try:
        report_data = _build_staff_report_data(staff_user, start_date, end_date)
        report_text = generate_gemini_report(report_data, report_type='staff', language=language)
        return jsonify({
            "success": True,
            "staff_id": staff_user.id,
            "staff_name": staff_user.full_name,
            "period": report_data["period"],
            "report": report_text,
            "language": language,
            "generated_at": datetime.utcnow().isoformat(),
        }), 200
    except RuntimeError as e:
        return jsonify({"success": False, "message": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "message": f"Report generation failed: {str(e)}"}), 500