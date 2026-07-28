import json
from datetime import datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import extract, func

from models import (
    db,
    BankLoan,
    CustomerProject,
    DCRCertificate,
    KSEB,
    KsebRegistrationCompletion,
    MaterialDelivery,
    MaterialInstallation,
    MNREInstallation,
    MNREProfile,
    PermissionRequest,
    Payment,
    Service,
    SiteVisit,
)

# --- adapt this import to your real auth module ---
from routes.auth_helpers import login_required, role_required, get_current_user

# admin_dashboard_bp = Blueprint("admin_dashboard", __name__, url_prefix="/api/admin/dashboard")
# staff_dashboard_bp = Blueprint("staff_dashboard", __name__, url_prefix="/api/staff/dashboard")
admin_dashboard_bp = Blueprint('admin_dashboard_bp',__name__)
staff_dashboard_bp = Blueprint('staff_dashboard_bp',__name__)

# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------

# Every module that has a work_done column, keyed by a friendly display name.
WORK_DONE_MODULES = {
    "Site Visit": SiteVisit,
    "MNRE Profile": MNREProfile,
    "MNRE Installation": MNREInstallation,
    "Bank Loan": BankLoan,
    "Payment": Payment,
    "KSEB": KSEB,
    "KSEB Registration": KsebRegistrationCompletion,
    "DCR Certificate": DCRCertificate,
    "Material Delivery": MaterialDelivery,
    "Material Installation": MaterialInstallation,
}

PENDING_VALUES = ("Pending", "Not Initiated")
SERVICE_PENDING_STATUSES = ("Faulty", "Needs Attention")

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# First year selectable in the dashboard's year picker / yearly view.
CHART_START_YEAR = 2025


def _pending_breakdown():
    """Returns (breakdown_list, total_pending) across all work_done modules + Service."""
    breakdown = []
    total_pending = 0

    for module_name, model in WORK_DONE_MODULES.items():
        count = (
            db.session.query(func.count(model.id))
            .filter(model.work_done.in_(PENDING_VALUES))
            .scalar()
            or 0
        )
        breakdown.append({"module": module_name, "pending_count": count})
        total_pending += count

    service_pending = (
        db.session.query(func.count(Service.id))
        .filter(Service.system_status.in_(SERVICE_PENDING_STATUSES))
        .scalar()
        or 0
    )
    breakdown.append({"module": "Service", "pending_count": service_pending})
    total_pending += service_pending

    return breakdown, total_pending


def _available_years():
    """Years selectable in the UI: CHART_START_YEAR through the current year."""
    current_year = datetime.utcnow().year
    if current_year < CHART_START_YEAR:
        return [CHART_START_YEAR]
    return list(range(CHART_START_YEAR, current_year + 1))


# ---------------------------------------------------------------------------
# ADMIN endpoints
# ---------------------------------------------------------------------------

@admin_dashboard_bp.route("/new-customers-per-month", methods=["GET"])
@login_required
@role_required("admin")
def new_customers_per_month():
    """
    Monthly view for the requested year (defaults to current year, and is
    clamped to CHART_START_YEAR..current_year):
      - new_customers        -> green line, count added that month
      - cumulative_total      -> red line, running customer count
      - new_capacity_kw       -> capacity (kW) added that month
      - cumulative_capacity_kw -> blue line, running installed capacity (kW)
    Also returns the all-time total customer count / capacity for the cards
    above the chart, and the list of years the year-picker should offer.
    """
    available_years = _available_years()
    year = request.args.get("year", datetime.utcnow().year, type=int)
    if year not in available_years:
        year = available_years[-1]

    rows = (
        db.session.query(
            extract("month", CustomerProject.created_date).label("month"),
            func.count(CustomerProject.id).label("count"),
            func.coalesce(func.sum(CustomerProject.capacity_kw), 0).label("capacity"),
        )
        .filter(extract("year", CustomerProject.created_date) == year)
        .group_by("month")
        .order_by("month")
        .all()
    )
    monthly = {int(r.month): (r.count, float(r.capacity)) for r in rows}

    totals_before_year = (
        db.session.query(
            func.count(CustomerProject.id),
            func.coalesce(func.sum(CustomerProject.capacity_kw), 0),
        )
        .filter(extract("year", CustomerProject.created_date) < year)
        .one()
    )
    total_customers_before = totals_before_year[0] or 0
    total_capacity_before = float(totals_before_year[1] or 0)

    series = []
    running_total = total_customers_before
    running_capacity = total_capacity_before
    for i, label in enumerate(MONTH_LABELS, start=1):
        new_count, new_capacity = monthly.get(i, (0, 0.0))
        running_total += new_count
        running_capacity += new_capacity
        series.append({
            "month": label,
            "new_customers": new_count,               # -> green line
            "cumulative_total": running_total,          # -> red line
            "new_capacity_kw": round(new_capacity, 2),
            "cumulative_capacity_kw": round(running_capacity, 2),  # -> blue line
        })

    grand_total = db.session.query(func.count(CustomerProject.id)).scalar() or 0
    grand_capacity = float(
        db.session.query(func.coalesce(func.sum(CustomerProject.capacity_kw), 0)).scalar() or 0
    )

    return jsonify({
        "year": year,
        "available_years": available_years,
        "total_customers": grand_total,
        "total_capacity_kw": round(grand_capacity, 2),
        "series": series,
    })


@admin_dashboard_bp.route("/yearly-summary", methods=["GET"])
@login_required
@role_required("admin")
def yearly_summary():
    """
    Yearly rollup, one row per year from CHART_START_YEAR through the current
    year: new customers/capacity added that year, plus running cumulative
    totals so growth across years is visible in one chart.
    """
    years = _available_years()

    rows = (
        db.session.query(
            extract("year", CustomerProject.created_date).label("year"),
            func.count(CustomerProject.id).label("count"),
            func.coalesce(func.sum(CustomerProject.capacity_kw), 0).label("capacity"),
        )
        .group_by("year")
        .all()
    )
    by_year = {
        int(r.year): (r.count, float(r.capacity))
        for r in rows if r.year is not None
    }

    prior_customers = sum(c for y, (c, _cap) in by_year.items() if y < years[0])
    prior_capacity = sum(cap for y, (_c, cap) in by_year.items() if y < years[0])

    series = []
    running_customers = prior_customers
    running_capacity = prior_capacity
    for y in years:
        new_count, new_capacity = by_year.get(y, (0, 0.0))
        running_customers += new_count
        running_capacity += new_capacity
        series.append({
            "year": y,
            "new_customers": new_count,
            "new_capacity_kw": round(new_capacity, 2),
            "cumulative_customers": running_customers,
            "cumulative_capacity_kw": round(running_capacity, 2),
        })

    grand_capacity = float(
        db.session.query(func.coalesce(func.sum(CustomerProject.capacity_kw), 0)).scalar() or 0
    )
    grand_customers = db.session.query(func.count(CustomerProject.id)).scalar() or 0

    return jsonify({
        "total_capacity_kw": round(grand_capacity, 2),
        "total_customers": grand_customers,
        "series": series,
    })


@admin_dashboard_bp.route("/total-capacity", methods=["GET"])
@login_required
@role_required("admin")
def total_capacity():
    total = db.session.query(func.coalesce(func.sum(SiteVisit.system_capacity), 0)).scalar()
    project_count = db.session.query(func.count(CustomerProject.id)).scalar() or 0
    return jsonify({
        "total_capacity_kw": float(total),
        "project_count": project_count,
        "average_capacity_kw": round(float(total) / project_count, 2) if project_count else 0,
    })


@admin_dashboard_bp.route("/pending-summary", methods=["GET"])
@login_required
@role_required("admin")
def pending_summary():
    breakdown, total_pending = _pending_breakdown()
    return jsonify({"total_pending": total_pending, "breakdown": breakdown})


@admin_dashboard_bp.route("/project-status", methods=["GET"])
@login_required
@role_required("admin")
def project_status():
    """Aggregate Completed vs Pending across all work_done-bearing module records."""
    completed = 0
    total_projects = db.session.query(func.count(CustomerProject.id)).scalar() or 0
    for project in db.session.query(CustomerProject).all():
        all_completed = True
        for module_name, model in WORK_DONE_MODULES.items():
            module_records = db.session.query(model).filter_by(customer_project_id=project.id).all()
            if not module_records:
                all_completed = False
                break
            for record in module_records:
                if record.work_done != "Completed":
                    all_completed = False
                    break
            if not all_completed:
                break
        if all_completed:
            completed += 1
    pending = total_projects - completed
    return jsonify({"completed": completed, "pending": pending})


@admin_dashboard_bp.route("/district-distribution", methods=["GET"])
@login_required
@role_required("admin")
def district_distribution():
    rows = (
        db.session.query(CustomerProject.district, func.count(CustomerProject.id))
        .group_by(CustomerProject.district)
        .order_by(func.count(CustomerProject.id).desc())
        .all()
    )
    return jsonify([{"district": d or "Unknown", "customer_count": c} for d, c in rows])


@admin_dashboard_bp.route("/upcoming-services", methods=["GET"])
@login_required
@role_required("admin")
def upcoming_services():
    # PLACEHOLDER: no "next service due" scheduling exists yet.
    return jsonify({
        "placeholder": True,
        "message": "Upcoming service due dates will appear here once service scheduling is implemented.",
        "data": [],

    })

# <h2>Admin Dashboard</h2>
        #     <p className="welcome-back-text">Welcome back, {user?.full_name || 'Admin'} (System Super Admin)</p>
        #   </header>

@admin_dashboard_bp.route("/user-info", methods=["GET"])
@login_required
@role_required("admin")
def user_info():
    current_user = get_current_user()
    return jsonify({
        "full_name": current_user.full_name,
        "role": current_user.role,
    })


# ---------------------------------------------------------------------------
# STAFF endpoints
# ---------------------------------------------------------------------------

@staff_dashboard_bp.route("/pending-tasks", methods=["GET"])
@login_required
@role_required("staff")
def pending_tasks():
    current_user = get_current_user()

    matrix = {}
    perm_row = getattr(current_user, "permission_matrix", None)
    if perm_row and perm_row.permissions_matrix:
        try:
            matrix = json.loads(perm_row.permissions_matrix)
        except Exception:
            matrix = {}

    allowed_modules = {
        name for name, perms in matrix.items()
        if isinstance(perms, dict) and perms.get("view")
    }

    tasks = []
    for module_name, model in WORK_DONE_MODULES.items():
        if module_name not in allowed_modules:
            continue
        rows = (
            db.session.query(model)
            .filter(model.work_done.in_(PENDING_VALUES))
            .limit(50)
            .all()
        )
        for r in rows:
            tasks.append({
                "module": module_name,
                "record_id": r.id,
                "customer_project_id": getattr(r, "customer_project_id", None),
                "customer_name": r.customer.customer_name if getattr(r, "customer", None) else None,
                "status": r.work_done,
            })

    return jsonify({"count": len(tasks), "tasks": tasks})


@staff_dashboard_bp.route("/district-distribution", methods=["GET"])
@login_required
@role_required("staff")
def staff_district_distribution():
    rows = (
        db.session.query(CustomerProject.district, func.count(CustomerProject.id))
        .group_by(CustomerProject.district)
        .order_by(func.count(CustomerProject.id).desc())
        .all()
    )
    return jsonify([{"district": d or "Unknown", "customer_count": c} for d, c in rows])


@staff_dashboard_bp.route("/completed-this-month", methods=["GET"])
@login_required
@role_required("staff")
def completed_this_month():
    current_user = get_current_user()
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    breakdown = []
    total = 0
    for module_name, model in WORK_DONE_MODULES.items():
        count = (
            db.session.query(func.count(model.id))
            .filter(
                model.work_done == "Completed",
                model.updated_by == current_user.id,
                model.updated_at >= month_start,
            )
            .scalar()
            or 0
        )
        if count:
            breakdown.append({"module": module_name, "completed_count": count})
        total += count

    return jsonify({
        "month_start": month_start.isoformat(),
        "total_completed": total,
        "breakdown": breakdown,
    })


@staff_dashboard_bp.route("/my-permission-requests", methods=["GET"])
@login_required
@role_required("staff")
def my_permission_requests():
    current_user = get_current_user()
    rows = (
        PermissionRequest.query
        .filter_by(user_id=current_user.id)
        .order_by(PermissionRequest.requested_at.desc())
        .all()
    )
    return jsonify([
        {
            "id": r.id,
            "module_name": r.module_name,
            "permission_type": r.permission_type,
            "status": r.status,
            "requested_at": r.requested_at.isoformat() if r.requested_at else None,
        }
        for r in rows
    ])