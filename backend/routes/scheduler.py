from apscheduler.schedulers.background import BackgroundScheduler
from routes.notification_rules import run_daily_notification_checks


def start_scheduler(app):
    """
    Starts a background job that runs the maintenance-notification checks
    twice a day (roughly matching the "2 messages per day" requirement).

    Call this once from app.py, after db.create_all(), e.g.:

        from scheduler import start_scheduler
        ...
        with app.app_context():
            db.create_all()
        start_scheduler(app)

    NOTE: if running with `flask run` / `app.run(debug=True)` and the
    Werkzeug reloader enabled, this can start twice (once per reloader
    process). Run with `use_reloader=False` in dev, or behind a real WSGI
    server (gunicorn etc.) in production, to avoid duplicate jobs.
    """
    scheduler = BackgroundScheduler()

    def job():
        print("DEBUG: scheduler job ticked")  # TEMP: remove after debugging
        with app.app_context():
            run_daily_notification_checks()

    # TEST VALUE: needs to run more often than NOTIFICATION_REPEAT_GAP_SECONDS (30s)
    # in notification_rules.py, otherwise the repeat gap can't be hit accurately.
    scheduler.add_job(job, 'interval', hours=8, id='notification_check', replace_existing=True)
    scheduler.start()
    print("DEBUG: scheduler.start() called")  # TEMP: remove after debugging
    return scheduler