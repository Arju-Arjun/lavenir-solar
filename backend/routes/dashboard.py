import json
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from sqlalchemy import extract, func, case

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
    CustomerAuditLog # Added for Recent Activities
)

from routes.auth_helpers import login_required, role_required, get_current_user

admin_dashboard_bp = Blueprint('admin_dashboard_bp',__name__)
staff_dashboard_bp = Blueprint('staff_dashboard_bp',__name__)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------

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

def _normalize_module_key(name):
    """Collapse whitespace and casing so minor formatting differences
    between the permissions UI and this dict don't cause a silent
    mismatch (e.g. 'Site Visit ' vs 'Site Visit', or different casing)."""
    return " ".join(name.strip().split()).casefold()


# The permissions matrix (see the staff permissions page) stores module
# names as typed there, which don't always match the WORK_DONE_MODULES
# keys used for stats. Map the known variants to the canonical key used
# in WORK_DONE_MODULES (or to "Service" for the alerts-only Service module,
# which isn't part of WORK_DONE_MODULES since it tracks system_status
# rather than work_done).
MODULE_NAME_ALIASES = {
    "payment flow": "Payment",
    "kseb feasibility": "KSEB",
    "dcr details": "DCR Certificate",
    "service / maintenance": "Service",
    "service/maintenance": "Service",
    "service maintenance": "Service",
    "material installation": "Material Installation",      
    "kseb registration & completion": "KSEB Registration",             
}

_CANONICAL_MODULE_LOOKUP = {_normalize_module_key(k): k for k in WORK_DONE_MODULES}
_CANONICAL_MODULE_LOOKUP[_normalize_module_key("Service")] = "Service"
for _alias, _canonical in MODULE_NAME_ALIASES.items():
    _CANONICAL_MODULE_LOOKUP[_normalize_module_key(_alias)] = _canonical

PENDING_VALUES = ("Pending", "Not Initiated")
SERVICE_PENDING_STATUSES = ("Faulty", "Needs Attention")

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

CHART_START_YEAR = 2025

def _pending_breakdown():
    """
    Pending = customers who don't yet have a "Completed" record for this
    module. This intentionally counts customers with NO row at all for the
    module (work not started) as pending, not just existing rows whose
    work_done is 'Pending'/'Not Initiated' — otherwise a customer whose
    SiteVisit/KSEB/etc. record hasn't been created yet would be silently
    dropped from this count, which desyncs it from _module_work_stats()
    and project_status() (both of which already do total - completed).
    """
    total_customers = db.session.query(func.count(CustomerProject.id)).scalar() or 0

    breakdown = []
    total_pending = 0
    for module_name, model in WORK_DONE_MODULES.items():
        completed = (
            db.session.query(func.count(func.distinct(model.customer_project_id)))
            .filter(model.work_done == "Completed")
            .scalar() or 0
        )
        count = max(total_customers - completed, 0)
        breakdown.append({"module": module_name, "pending_count": count})
        total_pending += count

    service_pending = (db.session.query(func.count(Service.id)).filter(Service.system_status.in_(SERVICE_PENDING_STATUSES)).scalar() or 0)
    breakdown.append({"module": "Service", "pending_count": service_pending})
    # total_pending += service_pending
    return breakdown, total_pending

def _available_years():
    current_year = datetime.utcnow().year
    if current_year < CHART_START_YEAR:
        return [CHART_START_YEAR]
    return list(range(CHART_START_YEAR, current_year + 1))


def _get_allowed_modules(current_user):
    """
    Parse the user's permission matrix and return the set of module names
    they have 'update' access to.

    Every staff endpoint below used to re-implement this same
    getattr -> json.loads -> set-comprehension block. Centralizing it means
    a future change to how permissions are stored only has to happen once.
    """
    perm_row = getattr(current_user, "permission_matrix", None)
    if not perm_row or not perm_row.permissions_matrix:
        return set()
    try:
        matrix = json.loads(perm_row.permissions_matrix)
    except (TypeError, ValueError):
        return set()

    allowed = set()
    for module, perms in matrix.items():
        if not (isinstance(perms, dict) and perms.get("update")):
            continue
        canonical = _CANONICAL_MODULE_LOOKUP.get(_normalize_module_key(module))
        if canonical:
            allowed.add(canonical)
        # Unmapped module names (e.g. "Customer Profile", which has no
        # work_done tracking) are intentionally dropped here rather than
        # added raw — only names that resolve to a known module should
        # ever reach the stats/alerts logic below.
    return allowed


def _module_work_stats(allowed_modules):
   
    total_customers = db.session.query(func.count(CustomerProject.id)).scalar() or 0

    stats = []
    for module_name, model in WORK_DONE_MODULES.items():
        if module_name not in allowed_modules:
            continue
        completed = (
            db.session.query(func.count(func.distinct(model.customer_project_id)))
            .filter(model.work_done == "Completed")
            .scalar() or 0
        )
        completed = int(completed)
        pending = max(total_customers - completed, 0)
        stats.append({
            "module": module_name,
            "pending": pending,
            "completed": completed,
            "total": total_customers,
        })
    return stats



# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# due date functions for alerts

SERVICE_DUE_APPROX_DAYS = 182  # ~6 months
KSEB_REGISTRATION_DEADLINE_DAYS = 30
MAX_MAINTENANCE_SERVICES = 10  # contract covers 10 maintenance services; no further due date after this


def _kseb_registration_alerts():
    """
    Customers whose KSEB feasibility is 'completed' but who still haven't
    submitted KSEB registration. Deadline = feasibility date + 30 days;
    flagged as overdue once that deadline has passed.
    """
    rows = (
        db.session.query(CustomerProject, KSEB, KsebRegistrationCompletion)
        .join(KSEB, KSEB.customer_project_id == CustomerProject.id)
        .outerjoin(
            KsebRegistrationCompletion,
            KsebRegistrationCompletion.customer_project_id == CustomerProject.id,
        )
        .filter(KSEB.feasibility_status == "Complete")
        .filter(
            db.or_(
                KsebRegistrationCompletion.id.is_(None),
                KsebRegistrationCompletion.registration_submitted.is_(False),
            )
        )
        .all()
    )

    today = datetime.utcnow().date()
    alerts = []
    for project, kseb, _reg in rows:
        feasibility_date = project.feasibility_notified_date
        if not feasibility_date and kseb.updated_at:
            feasibility_date = kseb.updated_at.date()
        if not feasibility_date:
            continue

        deadline_date = feasibility_date + timedelta(days=KSEB_REGISTRATION_DEADLINE_DAYS)
        days_left = (deadline_date - today).days

        alerts.append({
            "customer_id": project.customer_id,
            "customer_name": project.customer_name,
            "feasibility_date": feasibility_date.isoformat(),
            "deadline_date": deadline_date.isoformat(),
            "days_left": days_left,
            "is_overdue": days_left < 0,
        })

    alerts.sort(key=lambda a: a["days_left"])
    return alerts


def _project_all_modules_completed_date(customer_project_id):
    """
    Returns the latest 'updated_at' across all WORK_DONE_MODULES for this
    project, but only if every module has at least one record and every
    record is 'Completed'. Returns None if the project isn't fully done yet.
    """
    latest = None
    for model in WORK_DONE_MODULES.values():
        rows = (
            db.session.query(model.work_done, model.updated_at)
            .filter(model.customer_project_id == customer_project_id)
            .all()
        )
        if not rows or any(r.work_done != "Completed" for r in rows):
            return None
        module_latest = max((r.updated_at for r in rows if r.updated_at), default=None)
        if module_latest and (latest is None or module_latest > latest):
            latest = module_latest
    return latest


def _service_due_alerts():
    """
    Next-service-due list.
      Logic 1 (new customer, no maintenance record yet): all-modules
        completed date + 6 months.
      Logic 2 (first/any service already added): pulled from the most
        recent maintenance Service row's own `next_service_due` field if
        it's set there; otherwise falls back to
        CustomerProject.last_maintenance_added_date + 6 months.
      Contract complete: once maintenance_count reaches
        MAX_MAINTENANCE_SERVICES (10), the customer is dropped from this
        list entirely - there's no "next" service left to be due.
    """
    today = datetime.utcnow().date()
    alerts = []

    for project in CustomerProject.query.all():
        if (project.maintenance_count or 0) >= MAX_MAINTENANCE_SERVICES:
            continue  # all 10 contracted services done - nothing left due

        if project.last_maintenance_added_date:
            basis = "last_maintenance"
            maintenance_service_count = (
                db.session.query(func.count(Service.id))
                .filter(Service.customer_project_id == project.id)
                .filter(Service.service_type.ilike("maint%"))
                .scalar() or 0
            )
            latest_service = (
                db.session.query(Service)
                .filter(Service.customer_project_id == project.id)
                .filter(Service.service_type.ilike("maint%"))
                .order_by(Service.service_date.desc(), Service.id.desc())
                .first()
            )
            if latest_service and latest_service.next_service_due:
                due_date = latest_service.next_service_due.date()
            else:
                due_date = (project.last_maintenance_added_date + timedelta(days=SERVICE_DUE_APPROX_DAYS)).date()
        else:
            completed_at = _project_all_modules_completed_date(project.id)
            if not completed_at:
                continue
            basis = "all_modules_completed"
            due_date = (completed_at + timedelta(days=SERVICE_DUE_APPROX_DAYS)).date()

        #Maintain Service number count specific customer project
        count = (
            db.session.query(func.count(Service.id))
            .filter(Service.customer_project_id == project.id)
            .filter(Service.service_type.ilike("maint%"))
            .scalar() or 0
        )

       


        

        days_left = (due_date - today).days
        alerts.append({
            "customer_id": project.customer_id,
            "customer_name": project.customer_name,
            "due_date": due_date.isoformat(),
            "days_left": days_left,
            "basis": basis,
            "is_overdue": days_left < 0,
            "maintenance_service_count": count,
        })

    alerts.sort(key=lambda a: a["days_left"])
    return alerts




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
            func.count(func.distinct(CustomerProject.id)).label("count"),
            func.coalesce(func.sum(SiteVisit.system_capacity), 0).label("capacity"),
        )
        .outerjoin(SiteVisit, SiteVisit.customer_project_id == CustomerProject.id)
        .filter(extract("year", CustomerProject.created_date) == year)
        .group_by("month")
        .order_by("month")
        .all()
    )
    monthly = {int(r.month): (r.count, float(r.capacity)) for r in rows}

    totals_before_year = (
        db.session.query(
            func.count(func.distinct(CustomerProject.id)),
            func.coalesce(func.sum(SiteVisit.system_capacity), 0),
        )
        .outerjoin(SiteVisit, SiteVisit.customer_project_id == CustomerProject.id)
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
        db.session.query(func.coalesce(func.sum(SiteVisit.system_capacity), 0)).scalar() or 0
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
            func.count(func.distinct(CustomerProject.id)).label("count"),
            func.coalesce(func.sum(SiteVisit.system_capacity), 0).label("capacity"),
        )
        .outerjoin(SiteVisit, SiteVisit.customer_project_id == CustomerProject.id)
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
        db.session.query(func.coalesce(func.sum(SiteVisit.system_capacity), 0)).scalar() or 0
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
    """
    Aggregate Completed vs Pending across all work_done-bearing module records.

    OPTIMIZATION: this used to loop over every CustomerProject and, for each
    one, run a separate query per module and then check every record in
    Python (projects x modules round-trips, i.e. thousands of queries for
    a modest dataset). A project only counts as "completed" if it has at
    least one record in every module AND all those records are
    "Completed" — so instead we compute, per module, the set of project
    ids that satisfy that module (one GROUP BY query per module), then
    intersect those sets across all modules. That's one query per module
    total, regardless of how many projects exist.
    """
    total_projects = db.session.query(func.count(CustomerProject.id)).scalar() or 0
    all_project_ids = {pid for (pid,) in db.session.query(CustomerProject.id).all()}

    completed_ids = set(all_project_ids)
    for model in WORK_DONE_MODULES.values():
        rows = (
            db.session.query(
                model.customer_project_id,
                func.count(model.id),
                func.coalesce(func.sum(case((model.work_done == "Completed", 1), else_=0)), 0),
            )
            .group_by(model.customer_project_id)
            .all()
        )
        module_complete_ids = {cpid for cpid, total, done in rows if total and total == done}
        completed_ids &= module_complete_ids
        if not completed_ids:
            break

    completed = len(completed_ids)
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


@admin_dashboard_bp.route("/alerts", methods=["GET"])
@login_required
@role_required("admin")
# function used  _kseb_registration_alerts,service_due_alerts
def admin_alerts():
    try:
        kseb_registration_alerts = _kseb_registration_alerts()
        service_due_alerts = _service_due_alerts()

        return jsonify({
            "success": True,
            "kseb_registration_alerts": kseb_registration_alerts,
            "service_due_alerts": service_due_alerts,
        }), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500



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


# ---------------------------------------------------------------------------
# STAFF - shared alert helpers
#
# NOTE ON ASSUMPTIONS (please double-check against your actual workflow):
#   - "Feasibility received date" for the KSEB Registration alert is taken
#     from CustomerProject.feasibility_notified_date. If feasibility is
#     actually recorded elsewhere, point this at that field instead.
#   - "6 months" for the service due-date alert is approximated as 182 days.
#     Swap in dateutil.relativedelta(months=6) if you'd rather have calendar
#     month accuracy.
#   - A customer counts as "new" (Logic 1) when they have no
#     last_maintenance_added_date yet; once a maintenance/service record has
#     been added, CustomerProject.last_maintenance_added_date is treated as
#     the source of truth (Logic 2).
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# STAFF - Dashboard Summary (cards + pie chart data)
# ---------------------------------------------------------------------------

@staff_dashboard_bp.route("/summary", methods=["GET"])
@login_required
@role_required("staff")
def staff_dashboard_summary():
    """
    Cards:
      - total_assigned_modules: how many modules this staff member can
        update, plus a dropdown of total work items per module.
      - total_pending: total pending count across those modules, plus a
        per-module pending breakdown for the dropdown.
      - total_complete: total completed count across those modules, plus a
        per-module completed breakdown for the dropdown.

    pie_chart carries the same numbers pre-shaped for the frontend's 3-state
    interactive pie chart (Total / Pending / Complete click states).
    """
    try:
        current_user = get_current_user()
        allowed_modules = _get_allowed_modules(current_user)
        stats = _module_work_stats(allowed_modules)

        total_pending = sum(m["pending"] for m in stats)
        total_complete = sum(m["completed"] for m in stats)

        modules_dropdown = [{"module": m["module"], "total": m["total"]} for m in stats]
        pending_dropdown = [{"module": m["module"], "pending": m["pending"]} for m in stats]
        complete_dropdown = [{"module": m["module"], "completed": m["completed"]} for m in stats]

        return jsonify({
            "success": True,
            "cards": {
                "total_assigned_modules": {
                    "count": len(stats),
                    "modules": modules_dropdown,
                },
                "total_pending": {
                    "count": total_pending,
                    "modules": pending_dropdown,
                },
                "total_complete": {
                    "count": total_complete,
                    "modules": complete_dropdown,
                },
            },
            "pie_chart": {
                "total": {"pending": total_pending, "completed": total_complete},
                "pending_by_module": pending_dropdown,
                "completed_by_module": complete_dropdown,
            },
        }), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ---------------------------------------------------------------------------
# STAFF - Permission-based Special Alerts
# ---------------------------------------------------------------------------

@staff_dashboard_bp.route("/alerts", methods=["GET"])
@login_required
@role_required("staff")
def staff_alerts():
    """
    KSEB Registration alert only shows if the staff member has update
    permission on "KSEB Registration"; Service Due alert only shows if they
    have update permission on "Service". Either key is null if the staff
    member lacks that permission, so the frontend can hide the box entirely.
    """
    try:
        current_user = get_current_user()
        allowed_modules = _get_allowed_modules(current_user)

        kseb_registration_alerts = (
            _kseb_registration_alerts() if "KSEB Registration" in allowed_modules else None
        )
        service_due_alerts = (
            _service_due_alerts() if "Service" in allowed_modules else None
        )

        return jsonify({
            "success": True,
            "kseb_registration_alerts": kseb_registration_alerts,
            "service_due_alerts": service_due_alerts,
        }), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ---------------------------------------------------------------------------
# STAFF - Recently Updated Projects
# ---------------------------------------------------------------------------

@staff_dashboard_bp.route("/recent-activities", methods=["GET"])
@login_required
@role_required("staff")
def staff_recent_activities():
    """
    Latest updated projects (default 4) restricted to modules this staff
    member has permission for, so they can jump back into what they were
    last working on.
    """
    try:
        current_user = get_current_user()
        allowed_modules = _get_allowed_modules(current_user)

        if not allowed_modules:
            return jsonify({"success": True, "count": 0, "activities": []}), 200

        limit = request.args.get("limit", 4, type=int)

        logs = (
            CustomerAuditLog.query
            .filter(CustomerAuditLog.module_name.in_(allowed_modules))
            .order_by(CustomerAuditLog.timestamp.desc())
            .limit(limit)
            .all()
        )

        activities = []
        for log in logs:
            try:
                changes = json.loads(log.changes_payload) if log.changes_payload else {}
            except (TypeError, ValueError):
                changes = {}

            activities.append({
                "id": log.id,
                "customer_id": log.customer.customer_id if log.customer else None,
                "customer_name": log.customer.customer_name if log.customer else None,
                "module": log.module_name,
                "action": log.action,
                "description": ", ".join(changes.keys()) if changes else None,
                "performed_by": log.user.full_name if log.user else "System",
                "created_at": log.timestamp.isoformat() if log.timestamp else None,
            })

        return jsonify({"success": True, "count": len(activities), "activities": activities}), 200

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500