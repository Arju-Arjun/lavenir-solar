"""
Full Postgres backup via pg_dump -> Drive.

Uses DATABASE_URL directly (the same connection string the app itself
uses, via Neon's pooler). Every run produces a brand-new dump file (never
overwrites a prior one) - the DB is small, so a full dump per run is cheap
and simplest to restore from. Retention trims old dumps so Drive doesn't
grow forever.

Requires the postgresql-client package (for the pg_dump binary) to be
installed in the container - see the Dockerfile note in the accompanying
README.
"""

import os
import logging
import subprocess
import tempfile
from datetime import datetime, timezone

from . import drive_client

logger = logging.getLogger(__name__)

DB_DUMP_SUBFOLDER = "db"
DEFAULT_RETENTION_COUNT = 20


def _root_folder_id():
    folder_id = os.getenv("DRIVE_BACKUP_FOLDER_ID")
    if not folder_id:
        raise RuntimeError("DRIVE_BACKUP_FOLDER_ID is not set in .env.")
    return folder_id


def _run_pg_dump(dump_path):
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set in .env.")

    cmd = [
        "pg_dump",
        "-Fc",              # compressed custom format - smaller, restorable with pg_restore
        "--no-owner",
        "--no-privileges",
        "-d", db_url,
        "-f", dump_path,
    ]
    logger.info("Running pg_dump -> %s", dump_path)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed (exit {result.returncode}): {result.stderr.strip()}")


def _prune_old_dumps(db_folder_id, retention_count):
    children = drive_client.list_children(db_folder_id)
    # Filenames are UTC timestamps (YYYY-MM-DD_HHMMSS.dump), which sort
    # lexicographically the same as chronologically.
    children.sort(key=lambda f: f["name"], reverse=True)

    stale = children[retention_count:]
    for f in stale:
        try:
            drive_client.delete_file_permanently(f["id"])
            logger.info("Pruned old DB dump: %s", f["name"])
        except Exception:
            logger.exception("Failed to prune old DB dump %s (id %s)", f["name"], f["id"])

    return len(stale)


def run_db_backup(retention_count=None):
    retention_count = retention_count or int(
        os.getenv("DB_BACKUP_RETENTION_COUNT", DEFAULT_RETENTION_COUNT)
    )

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    dump_path = os.path.join(tempfile.gettempdir(), f"db_{timestamp}.dump")

    try:
        _run_pg_dump(dump_path)

        root_id = _root_folder_id()
        db_folder_id = drive_client.ensure_folder(DB_DUMP_SUBFOLDER, root_id)

        filename = f"{timestamp}.dump"
        file_id = drive_client.upload_file(
            dump_path, db_folder_id, filename, mime_type="application/octet-stream"
        )
        logger.info("DB backup uploaded: %s (drive id %s)", filename, file_id)

        pruned = _prune_old_dumps(db_folder_id, retention_count)

        return {"status": "ok", "filename": filename, "drive_file_id": file_id, "pruned": pruned}
    finally:
        # Always clean up the local temp file, success or failure, so the
        # Render disk doesn't fill up over repeated runs.
        if os.path.exists(dump_path):
            os.remove(dump_path)