"""
Centralized notification business rules for the maintenance-service workflow.
(Modified for Fast Testing)
"""

from datetime import datetime, timedelta
from models import db, Notification, CustomerProject
from utils import check_all_modules_complete, get_all_admin_ids
from routes.push import create_notification_and_push

# ---- ടെസ്റ്റിംഗിന് വേണ്ടി മാറ്റിയിരിക്കുന്ന വാല്യൂസ് ----
RENEWAL_PERIOD_MINUTES = 2          # 6 മാസത്തിന് പകരം 2 മിനിറ്റ്
RENEWAL_REMINDER_LEAD_SECONDS = 15  # 5 ദിവസത്തിന് പകരം 15 സെക്കൻഡ്
MAX_MAINTENANCE_SERVICES = 10


def can_send_today(customer_project_id, notif_type):
    """ടെസ്റ്റിംഗിന് വേണ്ടി ഡെയിലി ക്യാപ് (Daily Cap) പൂർണ്ണമായി ഒഴിവാക്കി അൺലിമിറ്റഡ് ആക്കിയിരിക്കുന്നു."""
    return True  # Always allow for testing purposes


def notify_admins(customer, title, body, notif_type):
    """Send a notification (DB row + push, per admin) to every admin user."""
    if not can_send_today(customer.id, notif_type):
        return

    for admin_id in get_all_admin_ids():
        create_notification_and_push(
            title=title,
            body=body,
            url=f"/admin/customers/{customer.customer_id}",
            notif_type=notif_type,
            user_id=admin_id,
            customer_project_id=customer.id
        )


def check_first_maintenance_due(customer):
    """Rule 1: all modules done, but no maintenance service added yet."""
    if (customer.maintenance_count or 0) > 0:
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
    """Rule 2: ടെസ്റ്റിംഗിനായി മിനിറ്റുകളും സെക്കൻഡുകളും വെച്ച് സെറ്റ് ചെയ്തിരിക്കുന്നു."""
    count = customer.maintenance_count or 0
    if count == 0 or count >= MAX_MAINTENANCE_SERVICES:
        return
    if not customer.last_maintenance_added_date:
        return

    # മിനിറ്റുകളും സെക്കൻഡുകളും ഉപയോഗിച്ചുള്ള ടൈം കാൽക്കുലേഷൻ
    due_date = customer.last_maintenance_added_date + timedelta(minutes=RENEWAL_PERIOD_MINUTES)
    reminder_start = due_date - timedelta(seconds=RENEWAL_REMINDER_LEAD_SECONDS)
    now = datetime.utcnow()

    if reminder_start <= now < due_date:
        notify_admins(
            customer,
            title="Maintenance Renewal Due Soon",
            body=f"{customer.customer_name}'s next maintenance service is due in {RENEWAL_REMINDER_LEAD_SECONDS} seconds.",
            notif_type="renewal_due"
        )


def run_daily_notification_checks():
    """Entry point called by the scheduler."""
    customers = CustomerProject.query.all()
    for customer in customers:
        check_first_maintenance_due(customer)
        check_maintenance_renewal_due(customer)

