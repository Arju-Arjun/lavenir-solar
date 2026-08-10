import logging
import threading
import traceback

from flask import Blueprint, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from utils import is_admin_user, send_failure_alert
from backup.runner import run_full_backup

logger = logging.getLogger(__name__)

backup_bp = Blueprint('backup', __name__)

# Guards against two overlapping runs (e.g. an admin double-clicking the
# button, or a manual trigger landing mid-scheduled-run) - pg_dump/Drive
# uploads take a while, and two concurrent runs would race on manifest.json.
_backup_lock = threading.Lock()


def _run_job(app):
    with _backup_lock:
        with app.app_context():
            try:
                result = run_full_backup(app)
                logger.info("Manual backup trigger finished: %s", result)
            except Exception as e:
                logger.exception("Manual backup trigger failed")
                send_failure_alert(
                    "Manual backup trigger failed",
                    str(e),
                    context=traceback.format_exc(),
                )


@backup_bp.route('/trigger', methods=['POST'])
@jwt_required()
def trigger_backup():
    uid = get_jwt_identity()
    if not is_admin_user(uid):
        return jsonify({"error": "Admin access required."}), 403

    if _backup_lock.locked():
        return jsonify({"message": "A backup is already running. Try again shortly."}), 409

    app = current_app._get_current_object()
    threading.Thread(target=_run_job, args=(app,), daemon=True).start()

    return jsonify({"message": "Backup started in the background."}), 202