"""
Centralized notification business rules for maintenance service workflow
and KSEB feasibility tracking.

All delays/gaps below are PRODUCTION values. Flip TESTING_MODE to True to
compress EVERY delay/gap/lead-time in this file — including the 6-month
maintenance reminders and the 9-day feasibility ramp — down to ~30s for
manual testing. The 8 AM-12 PM / 8 AM-midnight IST send windows are also
bypassed (treated as 0-24) under TESTING_MODE, so test notifications aren't
blocked by time of day.

Flip TESTING_MODE back to False before deploying — the real month/day
values (FIRST_MAINTENANCE_DUE_MONTHS, RENEWAL_DUE_MONTHS,
FEASIBILITY_TRIGGER_DAYS, DUE_REMINDER_LEAD_DAYS, DUE_REMINDER_FINAL_DAYS,
the 8 AM windows) are untouched in code and take over automatically.
"""

from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta  # pip install python-dateutil (if not already a dependency)
from models import db, Notification, CustomerProject, Service, KSEB, KsebRegistrationCompletion, DCRCertificate, SiteVisit, User
from utils import check_all_modules_complete, get_all_admin_ids, get_users_with_permission, get_users_with_permission_multi
from routes.push import create_notification_and_push

# ---------------------------------------------------------------------------
# TESTING TOGGLE
# ---------------------------------------------------------------------------
TESTING_MODE = True
_FAST_DELAY_SECONDS = 30
_FAST_GAP_SECONDS = 30

MAX_MAINTENANCE_SERVICES = 10         # Contract covers 10 maintenance services

NOTIF_TYPE_TAB_MAP = {
    "first_maintenance": "service",
    "renewal_due": "service",
    "contract_complete": "service",
    "feasibility_delay": "kseb",
    "registration_delay": "completion",
    "fee_pending": "completion",
    "dcr_delay": "dcr",
    "material_items_pending": "material-delivery",
    "installation_table_pending": "installation",
    "mnre_installation_pending": "mnre-installation",
    "material_usage_pending": "installation",
    "service_complete": "service",  # used by routes/service.py on create_service
    "complaint_registered": "complaints",
    "complaint_pending": "complaints",
    "complaint_assigned": "complaints",
}

# notif_type -> module_name (must match the exact MODULE_NAME strings used by
# check_permission() in the respective blueprint files), so alerts can be
# targeted at staff who hold 'update' permission on that module, not just
# admins. Values can be a single module name (str) or a list of module names
# (fans out to the union of everyone holding 'update' on any one of them —
# see get_users_with_permission_multi() in utils.py).
# NOTE: "Material Installation" is the actual MODULE_NAME used by
# material_installation.py / material_item.py, even though the admin
# permissions_matrix in utils.py lists it slightly differently — a
# pre-existing naming mismatch in the codebase, left as-is.
NOTIF_TYPE_MODULE_MAP = {
    "first_maintenance": "Service",
    "renewal_due": "Service",
    "contract_complete": "Service",
    "feasibility_delay": "Kseb",
    "registration_delay": "KSEB Registration & Completion",
    "fee_pending": "KSEB Registration & Completion",
    "dcr_delay": "DCR Details",
    "material_items_pending": "Material Delivery",
    "installation_table_pending": "Material Installation",
    "mnre_installation_pending": "MNRE Installation",
    "material_usage_pending": "Material Installation",
    "service_complete": "Service",
    # Most staff who handle complaints only hold a 'Service' permission grant
    # (no separate 'Complaints' grant set up per-user), so a single-module
    # lookup silently excludes them — a list here fans out to the union of
    # both groups.
    "complaint_registered": ["Complaints", "Service"],
    "complaint_pending": ["Complaints", "Service"],
}

# ===========================================================================
# TIMING CONFIG
# ===========================================================================

# ---- 1. First maintenance service (all modules complete -> 6 months) & ----
# ---- 2. Maintenance renewal (last service -> 6 months) ----
# Both share the same "N days before due date" cadence: 1x/day starting
# DUE_REMINDER_LEAD_DAYS before the due date, ramping to 2x/day inside the
# final DUE_REMINDER_FINAL_DAYS (and staying at 2x/day for as long as it
# remains overdue afterwards). Sends only land inside an 8 AM-12 PM IST
# window — narrower than every other notif_type's window below.
FIRST_MAINTENANCE_DUE_MONTHS = 6
RENEWAL_DUE_MONTHS = 6
DUE_REMINDER_LEAD_DAYS = 7
DUE_REMINDER_FINAL_DAYS = 2
DUE_REMINDER_WINDOW_START_HOUR = 0 if TESTING_MODE else 8    # 8 AM IST (bypassed to all-day under TESTING_MODE)
DUE_REMINDER_WINDOW_END_HOUR = 24 if TESTING_MODE else 12    # 12 PM noon IST (bypassed to all-day under TESTING_MODE)

# TESTING_MODE-aware versions of the above: production keeps the real
# month/day values via relativedelta/timedelta; testing collapses every one
# of them to _FAST_DELAY_SECONDS/_FAST_GAP_SECONDS (30s) so due dates, lead
# times, and repeat gaps are all testable within seconds instead of months.
MAINTENANCE_DUE_OFFSET = timedelta(seconds=_FAST_DELAY_SECONDS) if TESTING_MODE else relativedelta(months=FIRST_MAINTENANCE_DUE_MONTHS)
RENEWAL_DUE_OFFSET = timedelta(seconds=_FAST_DELAY_SECONDS) if TESTING_MODE else relativedelta(months=RENEWAL_DUE_MONTHS)
DUE_REMINDER_LEAD_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else DUE_REMINDER_LEAD_DAYS * 86400
DUE_REMINDER_FINAL_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else DUE_REMINDER_FINAL_DAYS * 86400
DUE_REMINDER_NORMAL_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 20 * 3600   # ~20h -> reliably 1 send/day inside any daily window below 20h wide

# ---- 3. KSEB feasibility delay (site visit created -> feasibility pending) ----
# Starts firing 9 days after the site visit is created, then reuses the
# exact same lead/final-day ramp as #1/#2 above (see check_feasibility_delay)
# but against the GENERAL 8 AM-midnight window, not the narrow 8-12 one.
FEASIBILITY_TRIGGER_DAYS = 9
FEASIBILITY_TRIGGER_OFFSET = timedelta(seconds=_FAST_DELAY_SECONDS) if TESTING_MODE else timedelta(days=FEASIBILITY_TRIGGER_DAYS)

# ---- 4. KSEB registration delay (feasibility complete -> registration not submitted) ----
REGISTRATION_DELAY_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 20 * 86400
REGISTRATION_DELAY_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 5 * 3600

# ---- 5. KSEB registration fee pending (registration submitted -> fee unpaid) ----
FEE_PENDING_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 86400        # next day
FEE_PENDING_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 12 * 3600  # twice a day

# ---- 6. DCR delay (panel delivered -> certificate not sold) ----
DCR_DELAY_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 86400          # 1 day
DCR_DELAY_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 12 * 3600    # 2x/day

# ---- 7. Material items pending (all 3 delivered -> no items added) ----
MATERIAL_ITEMS_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 5 * 3600
MATERIAL_ITEMS_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 12 * 3600

# ---- 8. Installation table pending (all items work_done='Completed' -> table not filled) ----
INSTALLATION_TABLE_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 5 * 3600
INSTALLATION_TABLE_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 12 * 3600

# ---- 9. MNRE installation pending (electrical+structure installed -> MNRE status not Completed) ----
MNRE_INSTALLATION_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 86400   # 1 day
MNRE_INSTALLATION_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 12 * 3600

# ---- 10. Material usage pending (electrical or structure installed -> items still show 0 used_quantity) ----
MATERIAL_USAGE_PENDING_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 3600     # 1 hour
MATERIAL_USAGE_PENDING_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 86400  # once a day

# ---- 11. Complaint pending (open complaint untouched -> nudge) ----
COMPLAINT_PENDING_DELAY_SECONDS = _FAST_DELAY_SECONDS if TESTING_MODE else 2 * 86400
COMPLAINT_PENDING_REPEAT_GAP_SECONDS = _FAST_GAP_SECONDS if TESTING_MODE else 2 * 86400

# ---------------------------------------------------------------------------
# GENERAL NOTIFICATION WINDOW (Admins should only be pinged 8 AM - midnight IST)
# ---------------------------------------------------------------------------
NOTIFICATION_WINDOW_TZ = ZoneInfo("Asia/Kolkata")
NOTIFICATION_WINDOW_START_HOUR = 0 if TESTING_MODE else 8   # 8:00 AM IST (bypassed to all-day under TESTING_MODE)
NOTIFICATION_WINDOW_END_HOUR = 24    # 12:00 AM IST / midnight (next day, exclusive)


# ===========================================================================
# COMMON / SHARED HELPERS (used by every check below)
# ===========================================================================

def _is_within_hour_window(start_hour, end_hour):
    """
    True only between start_hour and end_hour, IST. All timestamps in this
    file are stored/compared in UTC (datetime.utcnow()), so we convert to
    IST here just for this check instead of assuming the server's local time.
    """
    now_ist = datetime.utcnow().replace(tzinfo=ZoneInfo("UTC")).astimezone(NOTIFICATION_WINDOW_TZ)
    return start_hour <= now_ist.hour < end_hour


def is_within_notification_window():
    return _is_within_hour_window(NOTIFICATION_WINDOW_START_HOUR, NOTIFICATION_WINDOW_END_HOUR)


def can_send_today(customer_project_id, notif_type, gap_seconds):
    last = (
        Notification.query
        .filter_by(customer_project_id=customer_project_id, notif_type=notif_type)
        .order_by(Notification.created_at.desc())
        .first()
    )
    if not last:
        return True
    elapsed = (datetime.utcnow() - last.created_at).total_seconds()
    return elapsed >= gap_seconds


def _as_datetime(value):
    """
    Some columns (e.g. KsebRegistrationCompletion.registration_date) are saved
    as a plain `date`, not `datetime`. Normalize so we can safely subtract
    from datetime.utcnow() without raising a TypeError.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    return None


def ordinal(n):
    if 11 <= (n % 100) <= 13:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suffix}"


def _dispatch_to_module_staff(customer, title, body, notif_type, gap_seconds):
    """
    Core targeting + throttle + push logic: admins + any staff holding
    'update' permission on the module(s) this notif_type belongs to
    (NOTIF_TYPE_MODULE_MAP), falling back to admin-only if a notif_type is
    ever missing from the map. Shared by notify_module_staff() (general
    8 AM-midnight window) and check_due_date_reminder() (its own,
    possibly narrower, window) — callers are responsible for their own
    window check before calling this.
    """
    if not can_send_today(customer.id, notif_type, gap_seconds):
        return

    module_name = NOTIF_TYPE_MODULE_MAP.get(notif_type)
    if module_name:
        module_names = [module_name] if isinstance(module_name, str) else module_name
        target_ids = get_users_with_permission_multi(module_names, 'update')
    else:
        target_ids = get_all_admin_ids()

    tab = NOTIF_TYPE_TAB_MAP.get(notif_type, "service")
    for user_id in target_ids:
        create_notification_and_push(
            title=title,
            body=body,
            url=f"/customer-profile/{customer.customer_id}?tab={tab}",
            notif_type=notif_type,
            user_id=user_id,
            customer_project_id=customer.id
        )


def notify_module_staff(customer, title, body, notif_type, gap_seconds):
    """Gate on the general 8 AM-midnight window, then dispatch."""
    if not is_within_notification_window():
        return
    _dispatch_to_module_staff(customer, title, body, notif_type, gap_seconds)


def notify_user(user_id, title, body, url="/"):
    user = User.query.get(user_id)
    if user:
        create_notification_and_push(
            title=title,
            body=body,
            url=url,
            notif_type="user_alert",
            user_id=user.id
        )


def notify_assignee_and_admins(assignee_id, title, body, url="/"):
    """
    For a complaint that is already directed at one specific staff member
    (assigned at registration time, or via /assign), only that person +
    the admins need an alert - broadcasting to the whole 'Complaints'/
    'Service' permission group (notify_module_staff) is only right for
    complaints that are still unassigned.

    Mirrors notify_user() above in NOT gating on
    is_within_notification_window()/can_send_today() - this is an
    immediate, action-triggered alert tied to one specific complaint, not a
    periodic scheduler check that needs daily-repeat throttling.
    """
    target_ids = set(get_all_admin_ids())
    if assignee_id:
        target_ids.add(assignee_id)
    for user_id in target_ids:
        create_notification_and_push(
            title=title,
            body=body,
            url=url,
            notif_type="complaint_assigned",
            user_id=user_id
        )


def notify_users_by_role(role_name, title, body, url="/"):
    users = User.query.filter_by(role=role_name).all()
    for user in users:
        create_notification_and_push(
            title=title,
            body=body,
            url=url,
            notif_type="role_alert",
            user_id=user.id
        )


def check_due_date_reminder(customer, notif_type, due_date, title, body,
                             lead_seconds=DUE_REMINDER_LEAD_SECONDS,
                             final_seconds=DUE_REMINDER_FINAL_SECONDS,
                             window_start_hour=DUE_REMINDER_WINDOW_START_HOUR,
                             window_end_hour=DUE_REMINDER_WINDOW_END_HOUR):
    """
    Shared "N [days|seconds] before due date" reminder cadence, used by
    check_first_maintenance_due, check_maintenance_renewal_due, and
    check_feasibility_delay.

    - Starts `lead_seconds` before `due_date`.
    - Sends once/day (DUE_REMINDER_NORMAL_GAP_SECONDS) while more than
      `final_seconds` away from `due_date`.
    - Ramps to twice/day once inside the final `final_seconds` window, and
      stays at twice/day for as long as it remains overdue afterwards
      (seconds_to_due goes negative, which is still <= final_seconds).
    - Only ever sends inside the [window_start_hour, window_end_hour) IST
      window. The "twice/day" gap is derived from the window's own width
      (half the window, so both sends land inside it) rather than a fixed
      number, so this works correctly whether it's called with the narrow
      8-12 window (maintenance reminders) or the general 8-24 window
      (feasibility). Under TESTING_MODE both windows collapse to 0-24 and
      lead/final collapse to _FAST_DELAY_SECONDS, so the urgent gap falls
      back to _FAST_GAP_SECONDS instead of a window-derived value.
    """
    if not due_date:
        return

    now = datetime.utcnow()
    reminder_start = due_date - timedelta(seconds=lead_seconds)
    if now < reminder_start:
        return  # too early, not yet in the reminder period

    if not _is_within_hour_window(window_start_hour, window_end_hour):
        return

    seconds_to_due = (due_date - now).total_seconds()
    urgent = seconds_to_due <= final_seconds

    if urgent:
        if TESTING_MODE:
            gap_seconds = _FAST_GAP_SECONDS
        else:
            window_hours = max(1, window_end_hour - window_start_hour)
            gap_seconds = max(1, window_hours // 2) * 3600
    else:
        gap_seconds = DUE_REMINDER_NORMAL_GAP_SECONDS

    _dispatch_to_module_staff(customer, title=title, body=body, notif_type=notif_type, gap_seconds=gap_seconds)


# ===========================================================================
# SERVICE (maintenance) NOTIFICATIONS
# ===========================================================================

def get_actual_maintenance_data(customer):
    maint_services = (
        Service.query
        .filter(Service.service_customer_project_id == customer.id if hasattr(Service, 'service_customer_project_id') else Service.customer_project_id == customer.id)
        .filter(Service.service_type.ilike('maint%'))
        .order_by(Service.created_at.asc())
        .all()
    )
    actual_count = len(maint_services)
    actual_last_date = maint_services[-1].created_at if maint_services else None

    if customer.maintenance_count != actual_count or customer.last_maintenance_added_date != actual_last_date:
        customer.maintenance_count = actual_count
        customer.last_maintenance_added_date = actual_last_date
        db.session.commit()

    return actual_count, actual_last_date


def check_first_maintenance_due(customer):
    """
    Once all modules are complete, the first maintenance service is due
    FIRST_MAINTENANCE_DUE_MONTHS (6) later. Reminders start
    DUE_REMINDER_LEAD_DAYS (7) days before that due date, 1x/day, ramping to
    2x/day in the final 2 days / once overdue - see check_due_date_reminder.
    """
    count, _ = get_actual_maintenance_data(customer)
    if count > 0:
        return  # first maintenance already added

    if not check_all_modules_complete(customer):
        return  # not eligible yet

    # Anchor the 6-month countdown the first time all modules become
    # complete, so later edits to an already-complete module don't shift it.
    if not customer.modules_completed_at:
        customer.modules_completed_at = datetime.utcnow()
        db.session.commit()

    due_date = customer.modules_completed_at + MAINTENANCE_DUE_OFFSET
    overdue = datetime.utcnow() >= due_date

    check_due_date_reminder(
        customer,
        notif_type="first_maintenance",
        due_date=due_date,
        title="First Maintenance Service Overdue!" if overdue else "First Maintenance Service Due Soon",
        body=(
            f"{customer.customer_name}'s installation has been complete for over "
            f"{FIRST_MAINTENANCE_DUE_MONTHS} months. Please add the first maintenance service."
            if overdue else
            f"{customer.customer_name}'s installation is fully complete. The first maintenance "
            f"service is due soon."
        ),
    )


def check_maintenance_renewal_due(customer):
    count, last_maintenance_date = get_actual_maintenance_data(customer)
    if count == 0 or not last_maintenance_date:
        return

    if count >= MAX_MAINTENANCE_SERVICES:
        if can_send_today(customer.id, "contract_complete", gap_seconds=float('inf')):
            notify_module_staff(
                customer,
                title="Maintenance Contract Completed",
                body=f"{customer.customer_name} has completed all {MAX_MAINTENANCE_SERVICES} scheduled maintenance services.",
                notif_type="contract_complete",
                gap_seconds=float('inf')
            )
        return

    due_date = last_maintenance_date + RENEWAL_DUE_OFFSET
    overdue = datetime.utcnow() >= due_date

    check_due_date_reminder(
        customer,
        notif_type="renewal_due",
        due_date=due_date,
        title="Maintenance Service Overdue!" if overdue else "Maintenance Renewal Due Soon",
        body=(
            f"{customer.customer_name}'s {ordinal(count + 1)} maintenance service is overdue."
            if overdue else
            f"{customer.customer_name}'s {ordinal(count + 1)} maintenance service is due soon."
        ),
    )


# ===========================================================================
# FEASIBILITY (KSEB) NOTIFICATIONS
# ===========================================================================

def check_feasibility_delay(customer):
    """
    Starts alerting FEASIBILITY_TRIGGER_DAYS (9) days after the latest site
    visit is created, if KSEB feasibility is still not 'Complete'. Reuses
    check_due_date_reminder's 1x/day -> 2x/day ramp (against the GENERAL
    8 AM-midnight window, not the narrow one used for maintenance
    reminders) by treating `trigger_date` as the point the ramp should
    START: due_date - lead_days == trigger_date, so it fires from day 9
    onward exactly like the maintenance reminders do, just anchored to a
    different starting point.
    """
    latest_visit = (
        SiteVisit.query
        .filter_by(customer_project_id=customer.id)
        .order_by(SiteVisit.created_at.desc())
        .first()
    )
    if not latest_visit or not latest_visit.created_at:
        return

    latest_kseb = (
        KSEB.query
        .filter_by(customer_project_id=customer.id)
        .order_by(KSEB.created_at.desc())
        .first()
    )
    if latest_kseb and latest_kseb.feasibility_status == 'Complete':
        return  # done, no more nudges

    trigger_date = latest_visit.created_at + FEASIBILITY_TRIGGER_OFFSET
    synthetic_due_date = trigger_date + timedelta(seconds=DUE_REMINDER_LEAD_SECONDS)

    check_due_date_reminder(
        customer,
        notif_type="feasibility_delay",
        due_date=synthetic_due_date,
        title="KSEB Feasibility Pending Alert!",
        body=f"{customer.customer_name}'s site visit was created over {FEASIBILITY_TRIGGER_DAYS} days ago, and KSEB Feasibility is still pending.",
        window_start_hour=NOTIFICATION_WINDOW_START_HOUR,
        window_end_hour=NOTIFICATION_WINDOW_END_HOUR,
    )


def check_registration_delay(customer):
    
    latest_kseb = (
        KSEB.query
        .filter_by(customer_project_id=customer.id)
        .order_by(KSEB.created_at.desc())
        .first()
    )
    if not latest_kseb or latest_kseb.feasibility_status != 'Complete':
        return

    feasibility_done_at = _as_datetime(latest_kseb.updated_at)
    if not feasibility_done_at:
        return

    reg = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer.id).first()
    if reg and reg.registration_submitted:
        return  # already registered, nothing pending here

    elapsed = (datetime.utcnow() - feasibility_done_at).total_seconds()
    if elapsed < REGISTRATION_DELAY_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="KSEB Registration Delayed!",
        body=f"{customer.customer_name}'s KSEB Feasibility is complete, but registration has still not been submitted.",
        notif_type="registration_delay",
        gap_seconds=REGISTRATION_DELAY_REPEAT_GAP_SECONDS
    )


def check_fee_pending(customer):
   
    reg = KsebRegistrationCompletion.query.filter_by(customer_project_id=customer.id).first()
    if not reg or not reg.registration_submitted or reg.payment_done:
        return

    since = _as_datetime(reg.registration_date) or _as_datetime(reg.created_at)
    if not since:
        return

    elapsed = (datetime.utcnow() - since).total_seconds()
    if elapsed < FEE_PENDING_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="KSEB Registration Fee Pending!",
        body=f"{customer.customer_name}'s KSEB registration is submitted, but the fee has not been paid yet.",
        notif_type="fee_pending",
        gap_seconds=FEE_PENDING_REPEAT_GAP_SECONDS
    )


def check_dcr_delay(customer):
   
    delivery = customer.material_delivery_rel
    # Trigger is specifically "solar panel delivered" (panel_delivered), not
    # delivery.work_done == 'Completed' (which also requires electrical +
    # structure delivered + images) - DCR only cares about the panel.
    if not delivery or not delivery.panel_delivered:
        return

    delivered_at = _as_datetime(delivery.delivery_date) or _as_datetime(delivery.updated_at)
    if not delivered_at:
        return

    dcr = customer.dcr_certificate_rel
    if dcr and dcr.certificate_sold:
        return  # DCR already completed (certificate sold)

    elapsed = (datetime.utcnow() - delivered_at).total_seconds()
    if elapsed < DCR_DELAY_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="DCR Completion Pending!",
        body=f"{customer.customer_name}'s solar panel has been delivered, but the DCR certificate has still not been sold.",
        notif_type="dcr_delay",
        gap_seconds=DCR_DELAY_REPEAT_GAP_SECONDS
    )


def check_material_items_pending(customer):
   
    delivery = customer.material_delivery_rel
    if not delivery or not delivery.electrical_delivered or not delivery.panel_delivered or not delivery.structure_delivered:
        return  # delivery itself not confirmed complete yet (could be a bare auto-created row)

    if any((item.quantity or 0) > 0 for item in delivery.material_items):
        return

    delivered_at = _as_datetime(delivery.updated_at) or _as_datetime(delivery.delivery_date)
    if not delivered_at:
        return

    elapsed = (datetime.utcnow() - delivered_at).total_seconds()
    if elapsed < MATERIAL_ITEMS_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="Material Delivery Items Pending!",
        body=f"{customer.customer_name}'s material has been delivered, but the item list has still not been added.",
        notif_type="material_items_pending",
        gap_seconds=MATERIAL_ITEMS_REPEAT_GAP_SECONDS
    )


def check_installation_table_pending(customer):
    """
    Ella delivered material items-um work_done == 'Completed' aayittu
    INSTALLATION_TABLE_DELAY_SECONDS (5h) kazhinjittum Material Installation
    details table fill cheythittillenkil, 2x/day alert.

    NOTE: "Installation kazhinju" ennathinu dedicated field onnum
    illaathathinal, ella items-um use cheythu (work_done == 'Completed')
    ennathine proxy aayi edukkunnu.
    """
    delivery = customer.material_delivery_rel
    if not delivery or not delivery.material_items:
        return

    items = delivery.material_items
    if not all(item.work_done == 'Completed' for item in items):
        return  # installation not done on ground yet

    item_times = [_as_datetime(item.updated_at) for item in items if item.updated_at]
    if not item_times:
        return
    installed_at = max(item_times)

    installation = customer.material_installation_rel
    # MaterialInstallation gets an auto-created stub row for every customer
    # at customer-creation time, so a bare existence check would always be
    # true - check whether the row actually holds real installation data.
    if installation and (
        installation.electrical_installed
        or installation.structure_installed
        or installation.installation_completion_date
        or installation.installation_team
    ):
        return  # table already filled in with real data

    elapsed = (datetime.utcnow() - installed_at).total_seconds()
    if elapsed < INSTALLATION_TABLE_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="Installation Table Pending!",
        body=f"{customer.customer_name}'s installation is done, but the Material Installation details table has still not been filled.",
        notif_type="installation_table_pending",
        gap_seconds=INSTALLATION_TABLE_REPEAT_GAP_SECONDS
    )


def check_material_usage_pending(customer):
    """
    Material Installation-il Electrical Installation allenkil Structure
    Installation (eathenkilum onnu) complete aayittu
    MATERIAL_USAGE_PENDING_DELAY_SECONDS (1h) kazhinjittum, material items
    table-il eathenkilum item-inte used_quantity ippozhum 0 aanenkil -> alert.

    NOTE: material_items belongs to MaterialDelivery
    (customer.material_delivery_rel.material_items), not MaterialInstallation.
    """
    installation = customer.material_installation_rel
    if not installation or not (installation.electrical_installed or installation.structure_installed):
        return  # neither Electrical nor Structure installation marked complete yet

    delivery = customer.material_delivery_rel
    if not delivery or not delivery.material_items:
        return  # no material items recorded yet to check usage against

    if any((item.used_quantity or 0) > 0 for item in delivery.material_items):
        return  # at least one item already shows usage, consider it in progress

    marked_at = _as_datetime(installation.updated_at) or _as_datetime(installation.created_at)
    if not marked_at:
        return

    elapsed = (datetime.utcnow() - marked_at).total_seconds()
    if elapsed < MATERIAL_USAGE_PENDING_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="Material Usage Update Pending!",
        body=f"{customer.customer_name}'s installation has been marked complete, but some material items still show 0 used quantity.",
        notif_type="material_usage_pending",
        gap_seconds=MATERIAL_USAGE_PENDING_REPEAT_GAP_SECONDS
    )


def check_mnre_installation_pending(customer):
    """
    Material Installation-il Electrical Installation AND Structure
    Installation randum True aayittu MNRE_INSTALLATION_DELAY_SECONDS (1 day)
    kazhinjittum, MNRE Installation-nte "Installation Status" 'Completed'
    allenkil -> alert, 2x/day.
    """
    installation = customer.material_installation_rel
    if not installation or not (installation.electrical_installed and installation.structure_installed):
        return  # material installation (electrical + structure) itself not done yet

    completed_at = _as_datetime(installation.updated_at) or _as_datetime(installation.created_at)
    if not completed_at:
        return

    mnre = customer.mnre_installation_rel
    if mnre and mnre.installation_status == 'Completed':
        return  # MNRE Installation Status already complete

    elapsed = (datetime.utcnow() - completed_at).total_seconds()
    if elapsed < MNRE_INSTALLATION_DELAY_SECONDS:
        return

    notify_module_staff(
        customer,
        title="MNRE Installation Pending!",
        body=f"{customer.customer_name}'s material installation (electrical + structure) is done, but MNRE Installation Status has still not been marked 'Completed'.",
        notif_type="mnre_installation_pending",
        gap_seconds=MNRE_INSTALLATION_REPEAT_GAP_SECONDS
    )


def check_complaint_pending(customer):
    """
    Alerts on any complaint for this customer still sitting in
    Open / Assigned / In Progress / Reopened (i.e. not Resolved or Closed)
    more than COMPLAINT_PENDING_DELAY_SECONDS (2 days) after it last changed.

    Each complaint gets its own notif_type key (f"complaint_pending_{id}")
    so can_send_today's per-customer lookup tracks each complaint's alert
    cadence independently instead of one complaint's recent alert silencing
    another's on the same customer.

    Assigned complaints ping the assigned staff member directly (they're the
    one on the hook for it). Unassigned complaints fall back to
    notify_module_staff so any staff with 'update' permission on Complaints
    or Service, plus admins, can pick it up.

    Stops when the complaint is marked Resolved/Closed, or whenever anyone
    leaves a comment/update (Complaint.updated_at has onupdate=utcnow, so a
    touch to the row resets the timer for that complaint automatically).
    """
    open_complaints = [c for c in customer.complaints if c.status not in ('Resolved', 'Closed')]
    if not open_complaints:
        return

    for complaint in open_complaints:
        reference_time = _as_datetime(complaint.updated_at) or _as_datetime(complaint.created_at)
        if not reference_time:
            continue

        elapsed = (datetime.utcnow() - reference_time).total_seconds()
        if elapsed < COMPLAINT_PENDING_DELAY_SECONDS:
            continue

        notif_type = f"complaint_pending_{complaint.id}"
        if not is_within_notification_window():
            continue
        if not can_send_today(customer.id, notif_type, COMPLAINT_PENDING_REPEAT_GAP_SECONDS):
            continue

        title = "Complaint Pending Action!"
        body = f"{complaint.complaint_number} ({complaint.priority}) for {customer.customer_name} is still '{complaint.status}'."

        if complaint.assigned_to:
            # notify_user() doesn't gate on window/gap itself, so the checks
            # above are what actually throttle this branch.
            notify_user(
                complaint.assigned_to,
                title=title,
                body=body,
                url=f"/customer-profile/{customer.customer_id}?tab=complaints"
            )
        else:
            notify_module_staff(
                customer,
                title=title,
                body=body,
                notif_type=notif_type,
                gap_seconds=COMPLAINT_PENDING_REPEAT_GAP_SECONDS
            )


# ===========================================================================
# ORCHESTRATOR (called by the scheduler)
# ===========================================================================

def run_daily_notification_checks():
    customers = CustomerProject.query.all()
    print(f"DEBUG run_daily_notification_checks: {len(customers)} customers to check")

    # Each check gets its own try/except so one failing check for a customer
    # doesn't skip every check after it for that customer in the same cycle.
    checks = [
        check_first_maintenance_due,
        check_maintenance_renewal_due,
        check_feasibility_delay,
        check_registration_delay,
        check_fee_pending,
        check_dcr_delay,
        check_material_items_pending,
        check_installation_table_pending,
        check_material_usage_pending,
        check_mnre_installation_pending,
        check_complaint_pending,
    ]

    for customer in customers:
        for check_fn in checks:
            try:
                check_fn(customer)
            except Exception as e:
                import traceback
                print(f"!!! ERROR in {check_fn.__name__} for customer {getattr(customer, 'customer_id', '?')}: {e}")
                traceback.print_exc()