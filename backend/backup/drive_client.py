"""
Thin wrapper around the Google Drive v3 API, authenticated via OAuth as the
actual Google account (not a service account - service accounts have no
Drive storage quota of their own, which is why this uses a real user's
OAuth refresh token instead).

Auth: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and
GOOGLE_OAUTH_REFRESH_TOKEN in .env (obtained once via a local OAuth consent
flow) are used to build long-lived credentials - the refresh token doesn't
expire under normal use, so no repeat browser login is needed.

DRIVE_BACKUP_FOLDER_ID must be a folder that lives in this same account's
own Drive (uploads count against this account's personal storage quota).
"""

import os
import io
import logging

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]

_DRIVE_SERVICE = None


def get_drive_service():
    """Lazily-built, cached Drive API client."""
    global _DRIVE_SERVICE
    if _DRIVE_SERVICE is None:
        client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
        refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN")
        if not (client_id and client_secret and refresh_token):
            raise RuntimeError(
                "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / "
                "GOOGLE_OAUTH_REFRESH_TOKEN must all be set in .env."
            )
        creds = Credentials(
            None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
        _DRIVE_SERVICE = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _DRIVE_SERVICE


def _root_folder_id():
    folder_id = os.getenv("DRIVE_BACKUP_FOLDER_ID")
    if not folder_id:
        raise RuntimeError("DRIVE_BACKUP_FOLDER_ID is not set in .env.")
    return folder_id


def find_child(name, parent_id, mime_type=None, include_trashed=False):
    """
    Finds a direct child of parent_id by exact name. Returns the file
    resource dict (id, name, mimeType, modifiedTime) or None.
    """
    service = get_drive_service()
    safe_name = name.replace("'", "\\'")
    q = f"'{parent_id}' in parents and name = '{safe_name}'"
    if not include_trashed:
        q += " and trashed = false"
    if mime_type:
        q += f" and mimeType = '{mime_type}'"

    resp = service.files().list(
        q=q,
        fields="files(id, name, mimeType, modifiedTime, parents)",
        spaces="drive",
        pageSize=1,
    ).execute()
    files = resp.get("files", [])
    return files[0] if files else None


def ensure_folder(name, parent_id):
    """Finds a subfolder by name under parent_id, or creates it. Returns folder id."""
    existing = find_child(name, parent_id, mime_type="application/vnd.google-apps.folder")
    if existing:
        return existing["id"]

    service = get_drive_service()
    folder = service.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
    ).execute()
    return folder["id"]


def ensure_folder_path(path_segments, root_id=None):
    """
    Walks/creates a nested folder path, e.g. ["backups", "db"] under the
    configured root. Returns the id of the deepest folder.
    """
    parent_id = root_id or _root_folder_id()
    for segment in path_segments:
        if not segment:
            continue
        parent_id = ensure_folder(segment, parent_id)
    return parent_id


def upload_file(local_path, parent_id, filename, mime_type="application/octet-stream"):
    """Uploads a new file (always creates a new file - use for versioned/dated files)."""
    service = get_drive_service()
    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=True)
    file = service.files().create(
        body={"name": filename, "parents": [parent_id]},
        media_body=media,
        fields="id, name",
    ).execute()
    logger.info("Uploaded %s to Drive folder %s (file id %s)", filename, parent_id, file["id"])
    return file["id"]


def update_file_content(file_id, local_path, mime_type="application/octet-stream"):
    """Overwrites an existing file's content in place (keeps the same file id)."""
    service = get_drive_service()
    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=True)
    service.files().update(fileId=file_id, media_body=media).execute()
    return file_id


def upload_or_replace_text(parent_id, filename, text_content, mime_type="application/json"):
    """
    Finds filename under parent_id and overwrites its content, or creates it
    if missing. Used for manifest.json, which is a single file that gets
    rewritten every run (not versioned like the dated DB dumps).
    """
    service = get_drive_service()
    existing = find_child(filename, parent_id)
    media = MediaIoBaseDownload  # noqa: F841 (kept import used below via MediaIoBaseUpload alt path)
    from googleapiclient.http import MediaIoBaseUpload
    stream = io.BytesIO(text_content.encode("utf-8"))
    media_upload = MediaIoBaseUpload(stream, mimetype=mime_type, resumable=False)

    if existing:
        service.files().update(fileId=existing["id"], media_body=media_upload).execute()
        return existing["id"]

    file = service.files().create(
        body={"name": filename, "parents": [parent_id]},
        media_body=media_upload,
        fields="id",
    ).execute()
    return file["id"]


def download_text(file_id):
    """Downloads a Drive file's content as a decoded UTF-8 string."""
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue().decode("utf-8")


def list_children(parent_id, include_trashed=False):
    """Lists all direct children (files/folders) of parent_id, paginating as needed."""
    service = get_drive_service()
    q = f"'{parent_id}' in parents"
    if not include_trashed:
        q += " and trashed = false"

    results = []
    page_token = None
    while True:
        resp = service.files().list(
            q=q,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
            spaces="drive",
            pageSize=200,
            pageToken=page_token,
        ).execute()
        results.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return results


def move_file(file_id, new_parent_id, old_parent_id):
    """
    Moves a file between folders by swapping Drive 'parents' - Drive has no
    real move op, this is the standard way (equivalent to R2's
    copy_object + delete_object emulation in utils.move_r2_to_trash).
    """
    service = get_drive_service()
    service.files().update(
        fileId=file_id,
        addParents=new_parent_id,
        removeParents=old_parent_id,
        fields="id, parents",
    ).execute()


def delete_file_permanently(file_id):
    """Hard-deletes a file from Drive (bypasses Drive's own trash)."""
    service = get_drive_service()
    try:
        service.files().delete(fileId=file_id).execute()
        return True
    except HttpError as e:
        if e.resp.status == 404:
            return False  # already gone
        raise