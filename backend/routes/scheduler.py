import os
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from routes.notification_rules import run_daily_notification_checks

logger = logging.getLogger(__name__)

# The tightest cadence any rule in notification_rules.py needs is the
# "urgent" (final 2 days / overdue) maintenance-reminder ramp, which sends
# roughly every 2h inside its active window - and even that only needs to be
# *caught*, not hit to the second. Every other rule's gap is 5h+. 10 minutes
# gives comfortable margin on all of them without hammering the DB with a
# full customer x 11-check scan every 60s like the old test-mode interval did.
CHECK_INTERVAL_MINUTES = int(os.getenv("NOTIFICATION_CHECK_INTERVAL_MINUTES", "10"))

# Set to "false" on every gunicorn/uwsgi worker except one in a multi-worker
# deployment, so the job isn't scheduled (and doesn't fire duplicate
# notification checks) once per worker process.
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"


def start_scheduler(app):
    """
    Starts a background job that periodically runs the notification checks
    in notification_rules.py (run_daily_notification_checks), which each
    apply their own delay/repeat-gap/active-window logic per customer.

    Call this once from app.py, after db.create_all(), e.g.:

        from scheduler import start_scheduler
        ...
        with app.app_context():
            db.create_all()
        start_scheduler(app)

    NOTE: if running with `flask run` / `app.run(debug=True)` and the
    Werkzeug reloader enabled, this can start twice (once per reloader
    process). Run with `use_reloader=False` in dev, or behind a real WSGI
    server (gunicorn etc.) in production, to avoid duplicate jobs. In a
    multi-worker production deployment, set SCHEDULER_ENABLED=false on all
    but one worker for the same reason.
    """
    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=false; not starting.")
        return None

    scheduler = BackgroundScheduler()

    def job():
        with app.app_context():
            run_daily_notification_checks()

    scheduler.add_job(
        job,
        'interval',
        minutes=CHECK_INTERVAL_MINUTES,
        id='notification_check',
        replace_existing=True,
        # If the process was asleep/blocked and misses several ticks, run
        # once on wake instead of firing them all back-to-back.
        coalesce=True,
        misfire_grace_time=CHECK_INTERVAL_MINUTES * 60,
    )
    scheduler.start()
    logger.info("Notification scheduler started (every %s min).", CHECK_INTERVAL_MINUTES)
    return scheduler