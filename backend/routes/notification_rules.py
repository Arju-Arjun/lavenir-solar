"""
Centralized notification business rules for the maintenance-service workflow.
(Modified for Fast Testing: 3 Minutes interval, 1 Minute lead time)
"""

from datetime import datetime, timedelta
from models import db, Notification, CustomerProject, Service
from utils import check_all_modules_complete, get_all_admin_ids
from routes.push import create_notification_and_push

RENEWAL_PERIOD_MINUTES = 3            # TEST VALUE for "6 months"
RENEWAL_REMINDER_LEAD_SECONDS = 60    # TEST VALUE for "5 days" lead time
NOTIFICATION_REPEAT_GAP_SECONDS = 30  # TEST VALUE: gap between repeated notifications
MAX_MAINTENANCE_SERVICES = 10         # Contract covers 10 maintenance services;
                                       # renewal reminders stop once this many are done.


def get_actual_maintenance_data(customer):
    """
    Recalculate maintenance count and last-added date directly from the
    Service table instead of trusting the cached counters on CustomerProject.
    The cached fields can drift (e.g. if a service was ever removed outside
    the normal delete route), so this recomputes from real rows and corrects
    the cached fields whenever they've fallen out of sync.
    """
    maint_services = (
        Service.query
        .filter(Service.customer_project_id == customer.id)
        .filter(Service.service_type.ilike('maint%'))
        .order_by(Service.created_at.asc())
        .all()
    )
    actual_count = len(maint_services)
    actual_last_date = maint_services[-1].created_at if maint_services else None

    if customer.maintenance_count != actual_count or customer.last_maintenance_added_date != actual_last_date:
        print(f"DEBUG: correcting drifted maintenance data for customer={customer.customer_id} "
              f"stored_count={customer.maintenance_count} actual_count={actual_count} "
              f"stored_last={customer.last_maintenance_added_date} actual_last={actual_last_date}")  # TEMP
        customer.maintenance_count = actual_count
        customer.last_maintenance_added_date = actual_last_date
        db.session.commit()

    return actual_count, actual_last_date


def can_send_today(customer_project_id, notif_type, gap_seconds=NOTIFICATION_REPEAT_GAP_SECONDS):
    """
    Allow sending only if the last notification of this type for this
    customer/project was sent more than `gap_seconds` ago (or never sent
    before). This is what makes the reminder/overdue notification repeat
    continuously (every `gap_seconds`) instead of firing once.
    """
    last = (
        Notification.query
        .filter_by(customer_project_id=customer_project_id, notif_type=notif_type)
        .order_by(Notification.created_at.desc())
        .first()
    )
    if not last:
        print(f"DEBUG can_send_today: no previous '{notif_type}' notif for customer={customer_project_id} -> ALLOW")  # TEMP
        return True
    elapsed = (datetime.utcnow() - last.created_at).total_seconds()
    allowed = elapsed >= gap_seconds
    print(f"DEBUG can_send_today: customer={customer_project_id} notif_type={notif_type} "
          f"last_sent={last.created_at} elapsed={elapsed:.1f}s gap_needed={gap_seconds}s -> allow={allowed}")  # TEMP
    return allowed


def ordinal(n):
    """Convert 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th', 11 -> '11th', etc."""
    if 11 <= (n % 100) <= 13:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suffix}"


def notify_admins(customer, title, body, notif_type):
    if not can_send_today(customer.id, notif_type):
        return

    for admin_id in get_all_admin_ids():
        create_notification_and_push(
            title=title,
            body=body,
            url=f"/customer-profile/{customer.customer_id}?tab=service",
            notif_type=notif_type,
            user_id=admin_id,
            customer_project_id=customer.id
        )


def check_first_maintenance_due(customer):
    count, _ = get_actual_maintenance_data(customer)
    if count > 0:
        return  

    if not check_all_modules_complete(customer):
        return  

    notify_admins(
        customer,
        title="First Maintenance Service Due",
        body=f"{customer.customer_name}'s installation is fully complete. Please add the first maintenance service.",
        notif_type="first_maintenance"
    )


def check_maintenance_renewal_due(customer):
    """
    Fires the renewal notification starting RENEWAL_REMINDER_LEAD_SECONDS
    *before* the due date (reminder), and keeps firing (now as "overdue")
    every NOTIFICATION_REPEAT_GAP_SECONDS after the due date passes too.
    The ONLY thing that stops it is a new maintenance service being added,
    which pushes last_maintenance_added_date (and therefore due_date)
    into the future again.
    """
    count, last_maintenance_date = get_actual_maintenance_data(customer)
    if count == 0:
        return
    if not last_maintenance_date:
        return

    if count >= MAX_MAINTENANCE_SERVICES:
        # Contract's maintenance quota is used up — stop renewal reminders and
        # send a one-time completion notice instead.
        if can_send_today(customer.id, "contract_complete", gap_seconds=float('inf')):
            print(f"DEBUG renewal check: customer={customer.customer_id} reached the "
                  f"{MAX_MAINTENANCE_SERVICES}-service cap -> sending completion notice")  # TEMP
            notify_admins(
                customer,
                title="Maintenance Contract Completed",
                body=f"{customer.customer_name} has completed all {MAX_MAINTENANCE_SERVICES} scheduled maintenance services. No further renewal reminders will be sent.",
                notif_type="contract_complete"
            )
        return

    due_date = last_maintenance_date + timedelta(minutes=RENEWAL_PERIOD_MINUTES)
    reminder_start = due_date - timedelta(seconds=RENEWAL_REMINDER_LEAD_SECONDS)
    now = datetime.utcnow()

    print(f"DEBUG renewal check: customer={customer.customer_id} count={count} "
          f"last_maint={last_maintenance_date} due={due_date} "
          f"reminder_start={reminder_start} now={now}")  # TEMP

    if now < reminder_start:
        print("DEBUG renewal check: too early, skipping")  # TEMP
        return  # not time yet

    if now < due_date:
        print("DEBUG renewal check: sending REMINDER")  # TEMP
        notify_admins(
            customer,
            title="Maintenance Renewal Due Soon",
            body=f"{customer.customer_name}'s {ordinal(count + 1)} maintenance service is due soon. Please add the next service.",
            notif_type="renewal_due"
        )
    else:
        print("DEBUG renewal check: sending OVERDUE")  # TEMP
        notify_admins(
            customer,
            title="Maintenance Service Overdue!",
            body=f"{customer.customer_name}'s {ordinal(count + 1)} maintenance service is overdue. Please add the service log immediately.",
            notif_type="renewal_due"
        )


def run_daily_notification_checks():
    customers = CustomerProject.query.all()
    print(f"DEBUG run_daily_notification_checks: {len(customers)} customers to check")  # TEMP
    for customer in customers:
        try:
            check_first_maintenance_due(customer)
            check_maintenance_renewal_due(customer)
        except Exception as e:
            import traceback
            print(f"!!! ERROR checking customer {getattr(customer, 'customer_id', '?')}: {e}")
            traceback.print_exc()


from models import User
from routes.push import create_notification_and_push

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