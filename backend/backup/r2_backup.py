"""
Incremental R2 -> Drive mirror.

R2 objects are listed and compared against manifest.json (etag + size as
the change signal - cheap, no need to download-and-hash everything every
run). New/changed objects are downloaded to a temp file and uploaded/
overwritten on Drive, mirroring the same folder structure (minus the
leading "lavenir/" prefix, since DRIVE_BACKUP_FOLDER_ID already IS the
"backups" root).

Objects under utils.TRASH_PREFIX ("lavenir/trash/...") are skipped here on
purpose - when the app calls move_r2_to_trash(), the object's key changes
(it moves out from under its original key into trash). That means on the
*next* run, this same diff naturally notices the original key vanished and
routes it to _handle_removed_keys() below, which moves the Drive copy into
recycle_bin/. So trash handling falls out of the normal diff for free -
no special-casing needed here.
"""

import os
import logging
import tempfile
from datetime import datetime, timezone

from utils import get_r2_client, TRASH_PREFIX
from . import drive_client
from . import manifest as manifest_store

logger = logging.getLogger(__name__)

RECYCLE_BIN_SUBFOLDER = "recycle_bin"


def _root_folder_id():
    folder_id = os.getenv("DRIVE_BACKUP_FOLDER_ID")
    if not folder_id:
        raise RuntimeError("DRIVE_BACKUP_FOLDER_ID is not set in .env.")
    return folder_id


def _list_live_r2_objects(bucket):
    """Returns {key: {etag, size, last_modified}} for every object NOT under TRASH_PREFIX."""
    client = get_r2_client()
    paginator = client.get_paginator("list_objects_v2")
    objects = {}
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith(TRASH_PREFIX + "/"):
                continue
            objects[key] = {
                "etag": obj["ETag"].strip('"'),
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            }
    return objects


def _drive_path_parts(r2_key):
    """lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg -> (['JohnDoe_1023','sitevisit'], 'adhar_1023.jpg')"""
    relative = r2_key
    if relative.startswith("lavenir/"):
        relative = relative[len("lavenir/"):]
    parts = relative.split("/")
    folder_parts, filename = parts[:-1], parts[-1]
    return folder_parts, filename


def _download_r2_object(bucket, key, tmp_path):
    client = get_r2_client()
    client.download_file(bucket, key, tmp_path)


def _handle_new_or_changed(bucket, key, meta, root_id, manifest):
    folder_parts, filename = _drive_path_parts(key)
    folder_id = drive_client.ensure_folder_path(folder_parts, root_id=root_id)

    tmp_path = os.path.join(tempfile.gettempdir(), f"r2mirror_{os.getpid()}_{filename}")
    try:
        _download_r2_object(bucket, key, tmp_path)

        existing = manifest["files"].get(key)
        if existing and existing.get("drive_file_id"):
            file_id = drive_client.update_file_content(existing["drive_file_id"], tmp_path)
        else:
            file_id = drive_client.upload_file(tmp_path, folder_id, filename)

        manifest["files"][key] = {
            "drive_file_id": file_id,
            "etag": meta["etag"],
            "size": meta["size"],
            "last_modified": meta["last_modified"],
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _handle_removed_keys(removed_keys, root_id, manifest):
    for key in removed_keys:
        entry = manifest["files"].pop(key, None)
        if not entry or not entry.get("drive_file_id"):
            continue

        folder_parts, _filename = _drive_path_parts(key)
        old_folder_id = drive_client.ensure_folder_path(folder_parts, root_id=root_id)
        recycle_folder_id = drive_client.ensure_folder_path(
            [RECYCLE_BIN_SUBFOLDER] + folder_parts, root_id=root_id
        )

        try:
            drive_client.move_file(entry["drive_file_id"], recycle_folder_id, old_folder_id)
        except Exception:
            logger.exception("Failed to move Drive copy of %s into recycle_bin", key)
            # Still record it as removed from active backup even if the move
            # failed, rather than leaving it silently stuck in the loop forever.

        manifest["recycle_bin"][key] = {
            "drive_file_id": entry["drive_file_id"],
            "deleted_at": datetime.now(timezone.utc).isoformat(),
        }


def run_r2_backup():
    bucket = os.getenv("R2_BUCKET_NAME")
    root_id = _root_folder_id()

    live_objects = _list_live_r2_objects(bucket)
    manifest = manifest_store.load_manifest(root_id)

    uploaded, unchanged = 0, 0
    for key, meta in live_objects.items():
        existing = manifest["files"].get(key)
        if existing and existing.get("etag") == meta["etag"] and existing.get("size") == meta["size"]:
            unchanged += 1
            continue
        try:
            _handle_new_or_changed(bucket, key, meta, root_id, manifest)
            uploaded += 1
        except Exception:
            logger.exception("Failed to back up R2 object %s", key)

    removed_keys = set(manifest["files"].keys()) - set(live_objects.keys())
    _handle_removed_keys(removed_keys, root_id, manifest)

    manifest_store.save_manifest(root_id, manifest)

    return {
        "status": "ok",
        "uploaded_or_updated": uploaded,
        "unchanged": unchanged,
        "moved_to_recycle_bin": len(removed_keys),
    }