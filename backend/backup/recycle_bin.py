"""
Two independent 15-day retention sweeps:

1. R2 trash (lavenir/trash/...) - objects land here via utils.move_r2_to_trash(),
   called from the app itself whenever a user deletes/replaces a file. Age
   is judged by the object's own LastModified (which is refreshed by the
   copy_object move into trash), so no separate tracking is needed here.

2. Drive recycle_bin - entries land here via r2_backup._handle_removed_keys()
   whenever a backup run notices a previously-backed-up R2 key no longer
   exists. Age is tracked explicitly in manifest.json's "deleted_at",
   because Drive's own modifiedTime isn't a reliable proxy for "when did
   this get removed" (the move itself doesn't necessarily bump it the way
   we'd want, and we want it pinned to the moment the backup job detected
   the deletion, not to any earlier content edit).
"""

import os
import logging
from datetime import datetime, timedelta, timezone

from utils import get_r2_client, TRASH_PREFIX
from . import drive_client
from . import manifest as manifest_store

logger = logging.getLogger(__name__)

RETENTION_DAYS = int(os.getenv("RECYCLE_BIN_RETENTION_DAYS", "15"))


def _root_folder_id():
    folder_id = os.getenv("DRIVE_BACKUP_FOLDER_ID")
    if not folder_id:
        raise RuntimeError("DRIVE_BACKUP_FOLDER_ID is not set in .env.")
    return folder_id


def cleanup_r2_trash():
    """Permanently deletes R2 objects under lavenir/trash/ older than RETENTION_DAYS."""
    bucket = os.getenv("R2_BUCKET_NAME")
    client = get_r2_client()
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)

    paginator = client.get_paginator("list_objects_v2")
    deleted = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=TRASH_PREFIX + "/"):
        for obj in page.get("Contents", []):
            if obj["LastModified"] <= cutoff:
                try:
                    client.delete_object(Bucket=bucket, Key=obj["Key"])
                    deleted += 1
                    logger.info("Permanently deleted R2 trash object: %s", obj["Key"])
                except Exception:
                    logger.exception("Failed to permanently delete R2 trash object %s", obj["Key"])

    return {"status": "ok", "deleted": deleted}


def cleanup_drive_recycle_bin():
    """Permanently deletes Drive files whose recycle_bin entry is older than RETENTION_DAYS."""
    root_id = _root_folder_id()
    manifest = manifest_store.load_manifest(root_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)

    deleted_keys = []
    for key, entry in list(manifest["recycle_bin"].items()):
        try:
            deleted_at = datetime.fromisoformat(entry["deleted_at"])
        except Exception:
            continue  # malformed entry - leave it, don't guess

        if deleted_at <= cutoff:
            try:
                drive_client.delete_file_permanently(entry["drive_file_id"])
                logger.info("Permanently deleted Drive recycle_bin file for key: %s", key)
            except Exception:
                logger.exception("Failed to permanently delete Drive file for %s", key)
                continue  # keep the manifest entry so it's retried next run
            deleted_keys.append(key)

    for key in deleted_keys:
        manifest["recycle_bin"].pop(key, None)

    if deleted_keys:
        manifest_store.save_manifest(root_id, manifest)

    return {"status": "ok", "deleted": len(deleted_keys)}