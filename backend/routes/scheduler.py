import os
import logging
import traceback
from datetime import datetime, timedelta, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from routes.notification_rules import run_daily_notification_checks
from backup.runner import run_full_backup
from utils import send_failure_alert, send_keepalive_email

logger = logging.getLogger(__name__)


CHECK_INTERVAL_MINUTES = int(os.getenv("NOTIFICATION_CHECK_INTERVAL_MINUTES", "15"))


SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"


BACKUP_INTERVAL_DAYS = int(os.getenv("BACKUP_INTERVAL_DAYS", "4"))
BACKUP_HOUR_UTC = int(os.getenv("BACKUP_HOUR_UTC", "20"))
BACKUP_MINUTE_UTC = int(os.getenv("BACKUP_MINUTE_UTC", "30"))


# Brevo auto-deletes accounts after months of no login/action (as little as
# 4 months on the Free plan). 90 days keeps a wide safety margin under any
# of those windows. Kept well clear of the backup job's hour so the two
# never compete for the worker at the same moment.
KEEPALIVE_INTERVAL_DAYS = int(os.getenv("KEEPALIVE_INTERVAL_DAYS", "90"))
KEEPALIVE_HOUR_UTC = int(os.getenv("KEEPALIVE_HOUR_UTC", "21"))
KEEPALIVE_MINUTE_UTC = int(os.getenv("KEEPALIVE_MINUTE_UTC", "0"))


def _next_anchor(hour_utc, minute_utc, now=None):
    """
    Returns the next datetime (UTC) at hour_utc:minute_utc. Used as the
    anchor `start_date` for an APScheduler IntervalTrigger - it repeats
    every `days` starting from this timestamp, so the time-of-day it fires
    at is whatever this function returns. Shared by the backup and
    keepalive-email jobs below.
    """
    now = now or datetime.now(timezone.utc)
    candidate = now.replace(hour=hour_utc, minute=minute_utc, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _next_backup_start(now=None):
    """Next 2:00 AM IST run time for the backup job. See _next_anchor()."""
    return _next_anchor(BACKUP_HOUR_UTC, BACKUP_MINUTE_UTC, now)


def start_scheduler(app):
    
    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=false; not starting.")
        return None

    scheduler = BackgroundScheduler()

    def job():
        with app.app_context():
            try:
                run_daily_notification_checks()
            except Exception as e:
                logger.exception("Notification check failed")
                send_failure_alert(
                    "Notification check failed",
                    str(e),
                    context=traceback.format_exc(),
                )

    scheduler.add_job(
        job,
        'interval',
        minutes=CHECK_INTERVAL_MINUTES,
        id='notification_check',
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=CHECK_INTERVAL_MINUTES * 60,
    )

    def backup_job():
        with app.app_context():
            try:
                result = run_full_backup(app)
                logger.info("Scheduled backup finished: %s", result)
            except Exception as e:
                logger.exception("Scheduled backup failed")
                send_failure_alert(
                    "Scheduled backup failed",
                    str(e),
                    context=traceback.format_exc(),
                )

    backup_start = _next_backup_start()
    scheduler.add_job(
        backup_job,
        'interval',
        days=BACKUP_INTERVAL_DAYS,
        start_date=backup_start,
        id='periodic_backup',
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=3 * 60 * 60,
    )

    def keepalive_job():
        with app.app_context():
            try:
                send_keepalive_email()
                logger.info("Keepalive email sent")
            except Exception as e:
                logger.exception("Keepalive email job failed")
                send_failure_alert(
                    "Keepalive email job failed",
                    str(e),
                    context=traceback.format_exc(),
                )

    keepalive_start = _next_anchor(KEEPALIVE_HOUR_UTC, KEEPALIVE_MINUTE_UTC)
    scheduler.add_job(
        keepalive_job,
        'interval',
        days=KEEPALIVE_INTERVAL_DAYS,
        start_date=keepalive_start,
        id='brevo_keepalive_email',
        replace_existing=True,
        coalesce=True,
        misfire_grace_time=6 * 60 * 60,
    )

    scheduler.start()
    logger.info(
        "Notification scheduler started (every %s min); backup scheduled every %s day(s) "
        "at 02:00 IST, first run at %s UTC; keepalive email scheduled every %s day(s), "
        "first run at %s UTC.",
        CHECK_INTERVAL_MINUTES, BACKUP_INTERVAL_DAYS, backup_start.isoformat(),
        KEEPALIVE_INTERVAL_DAYS, keepalive_start.isoformat(),
    )
   
    for j in scheduler.get_jobs():
        logger.info("Scheduled job '%s' -> next run at %s", j.id, j.next_run_time)
    return scheduler