import logging

from . import db_backup
from . import r2_backup
from . import recycle_bin

logger = logging.getLogger(__name__)


def run_full_backup(app=None):
    """
    Runs, in order: DB dump -> R2 mirror -> R2 trash purge -> Drive recycle
    bin purge. Each step is wrapped independently so a failure in one
    (e.g. Drive quota hit during the R2 mirror) doesn't prevent the others
    from running - each result is recorded either way.

    `app` is accepted (and expected to already be the active app context
    when this is called - see routes/backup.py and scheduler.py) purely so
    future steps that need DB model access can use it; none of the current
    steps query the app's own database.
    """
    results = {}

    for name, fn in [
        ("db_backup", db_backup.run_db_backup),
        ("r2_backup", r2_backup.run_r2_backup),
        ("r2_trash_cleanup", recycle_bin.cleanup_r2_trash),
        ("drive_recycle_bin_cleanup", recycle_bin.cleanup_drive_recycle_bin),
    ]:
        try:
            results[name] = fn()
            logger.info("Backup step '%s' finished: %s", name, results[name])
        except Exception as e:
            logger.exception("Backup step '%s' failed", name)
            results[name] = {"status": "error", "error": str(e)}

    return results