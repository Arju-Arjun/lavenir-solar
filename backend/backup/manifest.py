"""
manifest.json lives as a single file on Drive, directly inside
DRIVE_BACKUP_FOLDER_ID. It's the state r2_backup.py diffs against to decide
what's new/changed/deleted, and what recycle_bin.py needs to permanently
purge after 15 days. Structure:

{
  "files": {
    "<r2 key, e.g. lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg>": {
      "drive_file_id": "...",
      "etag": "...",          # from R2 - used as the change signal
      "size": 12345,
      "last_modified": "2026-08-09T10:00:00+00:00"
    }
  },
  "recycle_bin": {
    "<same r2 key>": {
      "drive_file_id": "...",
      "deleted_at": "2026-08-09T10:00:00+00:00"
    }
  }
}

Unlike the dated DB dumps (always a new file), this one file is read,
mutated in memory, and overwritten every run.
"""

import json
import logging

from . import drive_client

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "manifest.json"

_EMPTY_MANIFEST = {"files": {}, "recycle_bin": {}}


def load_manifest(root_id):
    existing = drive_client.find_child(MANIFEST_FILENAME, root_id)
    if not existing:
        return dict(_EMPTY_MANIFEST)
    try:
        content = drive_client.download_text(existing["id"])
        manifest = json.loads(content)
    except Exception:
        logger.exception("manifest.json on Drive was unreadable/corrupt - starting fresh.")
        return dict(_EMPTY_MANIFEST)

    manifest.setdefault("files", {})
    manifest.setdefault("recycle_bin", {})
    return manifest


def save_manifest(root_id, manifest):
    content = json.dumps(manifest, indent=2)
    drive_client.upload_or_replace_text(root_id, MANIFEST_FILENAME, content)