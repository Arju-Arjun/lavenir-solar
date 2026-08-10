import json
import re
import os
import time
import requests
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import inspect as sa_inspect
from models import db, User, UserPermission, PermissionRequest, SiteVisit, KSEB
from flask import jsonify
from google import genai
from google.genai import errors as genai_errors


def send_reset_email(to_email, reset_link):
    """
    Sends the password-reset email via the Brevo transactional email HTTP
    API instead of raw SMTP. Render blocks outbound SMTP ports (25/465/587)
    on its free tier, which caused smtplib.SMTP() to hang indefinitely and
    eventually get the gunicorn worker SIGKILLed on WORKER TIMEOUT. This is
    a plain HTTPS call (port 443), so it isn't affected by that block, and
    the explicit timeout means a failure raises a normal exception quickly
    instead of hanging the worker.

    MAIL_FROM must be a sender address verified in the Brevo dashboard
    (Senders, Domains & Dedicated IPs -> Senders -> Add a sender) - it does
    not require owning/verifying a full domain.
    """
    api_key = os.getenv('BREVO_API_KEY')
    from_email = os.getenv('MAIL_FROM')

    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={
            "sender": {"email": from_email, "name": "Lavenir Solar"},
            "to": [{"email": to_email}],
            "subject": "Password Reset Request - Lavenir Solar",
            "textContent": (
                f"Hello,\n\nWe received a request to reset your password.\n\n"
                f"Click the link below to set a new password (valid for 15 minutes):\n{reset_link}\n\n"
                f"If you didn't request this, you can safely ignore this email."
            ),
        },
        timeout=10,
    )
    response.raise_for_status()


def send_failure_alert(subject, error_detail, context=None):
    """
    Sends an emergency alert email to EMERGENCY_MAIL whenever a background
    job (scheduled backup, manual backup trigger, notification check, etc.)
    fails. Call this from inside an `except` block with the exception's
    string representation (or traceback.format_exc()) as error_detail.

    This is best-effort and defensive on purpose: if EMERGENCY_MAIL/
    BREVO_API_KEY/MAIL_FROM aren't configured, or the alert email itself
    fails to send, that's only logged - it never raises, so a notification
    problem can't mask or replace the original failure that triggered it.
    """
    to_email = os.getenv('EMERGENCY_MAIL')
    api_key = os.getenv('BREVO_API_KEY')
    from_email = os.getenv('MAIL_FROM')

    if not to_email or not api_key or not from_email:
        print(f"send_failure_alert skipped (EMERGENCY_MAIL/BREVO_API_KEY/MAIL_FROM not set) - {subject}: {error_detail}")
        return

    text_content = f"{subject}\n\n{error_detail}"
    if context:
        text_content += f"\n\nContext:\n{context}"

    try:
        response = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "sender": {"email": from_email, "name": "Lavenir Solar Alerts"},
                "to": [{"email": to_email}],
                "subject": f"[Lavenir Solar ALERT] {subject}",
                "textContent": text_content,
            },
            timeout=10,
        )
        response.raise_for_status()
    except Exception as e:
        # Swallow on purpose - see docstring. Just log so it's visible in
        # server logs even though the admin didn't get the email.
        print(f"send_failure_alert: failed to send alert email for '{subject}': {str(e)}")


def send_keepalive_email():
    """
    Sends a harmless, auto-generated email via the Brevo transactional API
    purely to register as account "activity". Brevo auto-deletes accounts
    (Free plan: after 4 months idle; any plan per the general ToS: after 6
    months with no login/action) unless something happens on the account in
    between. Call this on a schedule well under that window (see
    KEEPALIVE_INTERVAL_DAYS in scheduler.py, default every 90 days) so the
    account never crosses the inactivity threshold.

    Sends to KEEPALIVE_MAIL if set, else falls back to EMERGENCY_MAIL, else
    MAIL_FROM (i.e. mails itself) - so no extra env var is strictly required
    beyond what send_failure_alert already needs.

    Best-effort/defensive like send_failure_alert: missing config or a
    delivery failure is only logged, never raised, so it can't take down
    the scheduler.
    """
    api_key = os.getenv('BREVO_API_KEY')
    from_email = os.getenv('MAIL_FROM')
    to_email = os.getenv('KEEPALIVE_MAIL') or os.getenv('EMERGENCY_MAIL') or from_email

    if not to_email or not api_key or not from_email:
        print(f"send_keepalive_email skipped (BREVO_API_KEY/MAIL_FROM/KEEPALIVE_MAIL not set)")
        return

    try:
        response = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "sender": {"email": from_email, "name": "Lavenir Solar"},
                "to": [{"email": to_email}],
                "subject": "Lavenir Solar - scheduled keepalive email",
                "textContent": (
                    "This is an automated keepalive email sent on a schedule "
                    "purely to keep the Brevo account active. No action is "
                    f"needed. Sent at {datetime.utcnow().isoformat()} UTC."
                ),
            },
            timeout=10,
        )
        response.raise_for_status()
    except Exception as e:
        # Swallow on purpose - see docstring.
        print(f"send_keepalive_email: failed to send keepalive email: {str(e)}")


_R2_CLIENT = None


def _get_r2_client():
    """Lazily-built S3-compatible client pointed at the R2 bucket."""
    global _R2_CLIENT
    if _R2_CLIENT is None:
        _R2_CLIENT = boto3.client(
            's3',
            endpoint_url=os.getenv('R2_ENDPOINT_URL'),
            aws_access_key_id=os.getenv('R2_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('R2_SECRET_ACCESS_KEY'),
            region_name='auto',
        )
    return _R2_CLIENT


def get_r2_client():
    """
    Public accessor for the lazily-built R2 client, so other modules
    (e.g. backup/r2_backup.py, backup/recycle_bin.py) can reuse the same
    client instead of building their own boto3 client with duplicated
    env-var wiring.
    """
    return _get_r2_client()


def get_r2_public_url(object_key):
    """Builds the public URL for an object key, given R2_PUBLIC_URL in .env."""
    base = os.getenv('R2_PUBLIC_URL', '').rstrip('/')
    return f"{base}/{object_key}"


def upload_to_r2(file_obj, object_key, content_type=None):
    """
    Uploads a file-like object (e.g. Flask's request.files['x']) to R2 under
    object_key (e.g. build_doc_path(...) below) and returns its public URL.
    """
    bucket = os.getenv('R2_BUCKET_NAME')
    extra_args = {'ContentType': content_type} if content_type else {}
    try:
        _get_r2_client().upload_fileobj(file_obj, bucket, object_key, ExtraArgs=extra_args)
        return get_r2_public_url(object_key)
    except ClientError as e:
        print(f"R2 upload fault for {object_key}: {str(e)}")
        raise


def _r2_key_from_url(file_url_or_key):
    """Strips the R2_PUBLIC_URL prefix (if present) to resolve a bare object key."""
    base = os.getenv('R2_PUBLIC_URL', '').rstrip('/')
    if base and file_url_or_key.startswith(base):
        return file_url_or_key[len(base):].lstrip('/')
    return file_url_or_key


def delete_r2_file(file_url_or_key):
    """
    Deletes an object from R2. Accepts either a full public URL (as stored
    on the model - the R2_PUBLIC_URL prefix is stripped to get the key) or
    a bare object key.
    """
    if not file_url_or_key:
        return False
    object_key = _r2_key_from_url(file_url_or_key)
    bucket = os.getenv('R2_BUCKET_NAME')
    try:
        _get_r2_client().delete_object(Bucket=bucket, Key=object_key)
        return True
    except ClientError as e:
        print(f"R2 asset cleanup fault for {object_key}: {str(e)}")
        return False


TRASH_PREFIX = "lavenir/trash"


def move_r2_to_trash(file_url_or_key):
    """
    Moves a single R2 object into TRASH_PREFIX instead of deleting it,
    preserving its original path underneath, e.g.:
        lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg
        -> lavenir/trash/JohnDoe_1023/sitevisit/adhar_1023.jpg

    R2/S3 has no native "rename" - this is emulated as copy-then-delete-
    original, which is what Cloudinary's uploader.rename() effectively did
    under the hood anyway. Returns the new public URL on success, or None
    if nothing was moved (e.g. already in trash, or on failure).
    """
    if not file_url_or_key:
        return None
    object_key = _r2_key_from_url(file_url_or_key)
    if object_key.startswith(TRASH_PREFIX + "/"):
        return None  # already sitting in trash

    new_key = f"{TRASH_PREFIX}/{object_key}"
    bucket = os.getenv('R2_BUCKET_NAME')
    try:
        client = _get_r2_client()
        client.copy_object(Bucket=bucket, CopySource={'Bucket': bucket, 'Key': object_key}, Key=new_key)
        client.delete_object(Bucket=bucket, Key=object_key)
        print(f"Moved R2 object to trash: {object_key} -> {new_key}")
        return get_r2_public_url(new_key)
    except ClientError as e:
        print(f"R2 trash-move skipped or failed for {object_key}: {str(e)}")
        return None


def is_admin_user(user_id):
    user = User.query.get(user_id)
    return bool(user and user.role and user.role.strip().lower() == 'admin')


def _permission_matrix_allows(user, permission_type, module_name):
    """Pure in-memory check against an already-loaded User — no query."""
    if user.role and user.role.strip().lower() == 'admin':
        return True
    perm_record = UserPermission.query.filter_by(user_id=user.id).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            return matrix.get(module_name, {}).get(permission_type) is True
        except Exception:
            return False
    return False


def permission_allows_for_user(user, permission_type, module_name):
    """
    Same in-memory check as check_permission(), but takes an already-loaded
    User object. Use this instead of check_permission() whenever the caller
    has already done User.query.get(uid) - avoids a redundant duplicate
    user fetch on every permission check.
    """
    return _permission_matrix_allows(user, permission_type, module_name)


def check_permission(user_id, permission_type, module_name):
    """
    Checks strictly against the live UserPermission matrix (single source of
    truth). No fallback to "any approved request ever" - process_permission_request()
    already writes approvals into the matrix at approval time, and a fallback
    would let access silently persist after an admin revokes it later.
    """
    user = User.query.get(user_id)
    if not user:
        return False
    return _permission_matrix_allows(user, permission_type, module_name)


def handle_blueprint_check_access(uid, module_name):
    """Centralized permission lookup for a single module (view/create/update/delete)."""
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "Context Error"}), 401

    pending_records = PermissionRequest.query.filter_by(
        user_id=uid, module_name=module_name, status='Pending'
    ).all()
    pending_requests_map = {req.permission_type: "Pending" for req in pending_records}

    if user.role and user.role.strip().lower() == 'admin':
        return jsonify({
            "view": True, "create": True, "update": True, "delete": True,
            "pending_requests": pending_requests_map,
        }), 200

    # 'create' is mapped to the same 'update' tier
    can_update = _permission_matrix_allows(user, 'update', module_name)
    permissions = {
        "view": _permission_matrix_allows(user, 'view', module_name),
        "create": can_update,
        "update": can_update,
        "delete": _permission_matrix_allows(user, 'delete', module_name),
        "pending_requests": pending_requests_map,
    }
    return jsonify(permissions), 200


def handle_blueprint_request_access(uid, module_name, data):
    permission_type = data.get('permission_type', 'view')
    if permission_type not in ['view', 'create', 'update']:
        return jsonify({"error": "Invalid tier specified or tier is disabled."}), 400

    existing = PermissionRequest.query.filter_by(
        user_id=uid, module_name=module_name,
        permission_type=permission_type, status='Pending'
    ).first()
    if existing:
        return jsonify({"message": f"An access request for the '{permission_type}' tier is already pending review."}), 200

    db.session.add(PermissionRequest(
        user_id=uid, module_name=module_name,
        permission_type=permission_type, status='Pending'
    ))
    db.session.commit()
    return jsonify({"message": f"Access request for '{permission_type}' submitted successfully to the administrator."}), 201


def handle_get_all_permissions(uid):
    """Full permission matrix for a user in one call, so the frontend can cache it."""
    user = User.query.get(uid)
    if not user:
        return jsonify({"msg": "User context not found"}), 404

    if user.role and user.role.strip().lower() == 'admin':
        modules = [
            'Payment Flow', 'Service', 'Site Visit', 'DCR',
            'Kseb', 'KSEB Registration & Completion', 'MNRE Profile',
            'Bank Loan', 'MNRE Installation', 'Material Delivery',
            'Material Installation', 'Complaints',
        ]
        admin_matrix = {mod: {"view": True, "create": True, "update": True, "delete": True} for mod in modules}
        return jsonify({"permissions_matrix": admin_matrix}), 200

    perm_record = UserPermission.query.filter_by(user_id=uid).first()
    if perm_record and perm_record.permissions_matrix:
        try:
            matrix = json.loads(perm_record.permissions_matrix)
            return jsonify({"permissions_matrix": matrix}), 200
        except Exception:
            pass

    return jsonify({"permissions_matrix": {}}), 200


def sanitize_path_segment(value):
    """Strips anything outside [A-Za-z0-9_-] so Cloudinary folder/file paths stay safe."""
    if value is None:
        return ""
    value = str(value).strip().replace(' ', '_')
    return re.sub(r'[^a-zA-Z0-9_-]', '', value)


def get_customer_folder(customer_name, customer_id):
    return f"{sanitize_path_segment(customer_name)}_{sanitize_path_segment(customer_id)}"


def get_module_folder_path(customer_name, customer_id, module_name):
    customer_folder = get_customer_folder(customer_name, customer_id)
    module_segment = sanitize_path_segment(module_name)
    return f"lavenir/{customer_folder}/{module_segment}"


def get_doc_filename(doctype, customer_id, ext):
    ext = str(ext).lstrip('.')
    return f"{sanitize_path_segment(doctype)}_{sanitize_path_segment(customer_id)}.{ext}"


def build_doc_path(customer_name, customer_id, module_name, doctype, ext):
    """
    lavenir/{customer_name}_{customer_id}/{module_name}/{doctype}_{customer_id}.{ext}
    e.g. build_doc_path("John Doe", 1023, "sitevisit", "adhar", "jpg")
         -> "lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg"
    """
    folder_path = get_module_folder_path(customer_name, customer_id, module_name)
    filename = get_doc_filename(doctype, customer_id, ext)
    return f"{folder_path}/{filename}"


def check_all_modules_complete(customer):
    """
    True only if all 10 workflow modules for this customer have
    work_done == 'Completed'. site_visits/kseb_records are queried
    explicitly ordered by created_at - the backref list order is not
    guaranteed by SQLAlchemy.
    """
    def done(rel):
        if rel is None:
            return False
        val = getattr(rel, 'work_done', None)
        return bool(val) and val.strip().lower() == 'completed'

    latest_site_visit = (
        SiteVisit.query.filter_by(customer_project_id=customer.id)
        .order_by(SiteVisit.created_at.desc()).first()
    )
    latest_kseb = (
        KSEB.query.filter_by(customer_project_id=customer.id)
        .order_by(KSEB.created_at.desc()).first()
    )

    checks = [
        done(latest_site_visit),
        done(customer.mnre_profile_rel),
        done(customer.mnre_installation_rel),
        done(customer.bank_loan_rel),
        done(customer.payment_rel),
        done(latest_kseb),
        done(customer.kseb_registration_rel),
        done(customer.dcr_certificate_rel),
        done(customer.material_delivery_rel),
        done(customer.material_installation_rel),
    ]
    return all(checks)


def get_all_admin_ids():
    return [u.id for u in User.query.filter_by(role='admin').all()]


def get_users_with_permission(module_name, permission_type='view'):
    return get_users_with_permission_multi([module_name], permission_type)


def get_users_with_permission_multi(module_names, permission_type='update'):
    """
    2 queries total regardless of user/module count: admins are fetched
    directly, every non-admin's permissions_matrix is fetched once and
    checked in memory against all module_names. Avoids the old N+1 pattern
    of calling check_permission() per user per module.
    """
    admin_ids = [u.id for u in User.query.filter_by(role='admin').all()]

    target_ids = list(admin_ids)
    non_admin_perms = (
        UserPermission.query
        .join(User, UserPermission.user_id == User.id)
        .filter(db.or_(User.role.is_(None), User.role != 'admin'))
        .all()
    )
    for perm in non_admin_perms:
        if not perm.permissions_matrix:
            continue
        try:
            matrix = json.loads(perm.permissions_matrix)
        except Exception:
            continue
        if any(matrix.get(mod, {}).get(permission_type) is True for mod in module_names):
            target_ids.append(perm.user_id)

    return target_ids


# ---------------------------------------------------------------------------
# GENERIC MODEL SERIALIZER
# ---------------------------------------------------------------------------
# Several module models (MaterialDelivery, MaterialInstallation, ...) don't
# define their own to_dict(). Rather than hand-writing/maintaining a dict for
# each one, this walks the SQLAlchemy column mapping directly. Models that DO
# have a to_dict() still use it (it's usually richer - e.g. includes
# customer_name), this is just the fallback.

def serialize_model(instance):
    if instance is None:
        return None

    if hasattr(instance, 'to_dict'):
        try:
            return instance.to_dict()
        except TypeError:
            pass  # some to_dict()s take optional args; fall through on mismatch

    result = {}
    mapper = sa_inspect(instance).mapper
    for column in mapper.columns:
        value = getattr(instance, column.key)
        if isinstance(value, datetime) or isinstance(value, date):
            value = value.isoformat()
        elif isinstance(value, Decimal):
            value = float(value)
        result[column.key] = value
    return result


# ---------------------------------------------------------------------------
# GEMINI-POWERED REPORT GENERATION
# ---------------------------------------------------------------------------

_GEMINI_CLIENT = None


def _get_gemini_client():
    global _GEMINI_CLIENT
    if _GEMINI_CLIENT is None:
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set in the environment. Add it to your .env file."
            )
        _GEMINI_CLIENT = genai.Client(api_key=api_key)
    return _GEMINI_CLIENT


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


LANGUAGE_INSTRUCTIONS = {
    'english': "Write the entire report in English.",
    'malayalam': (
        "Write the entire report in Malayalam, using Malayalam script "
        "(e.g. മലയാളം), not transliteration."
    ),
    'hindi': (
        "Write the entire report in Hindi, using Devanagari script "
        "(e.g. हिन्दी), not transliteration."
    ),
    'manglish': (
        "Write the entire report in Manglish - that is, Malayalam language "
        "and sentence structure, but written using plain English/Latin "
        "alphabet letters (no Malayalam script), the casual way Malayalees "
        "commonly type in chats (e.g. 'customer nte project 60% complete "
        "aanu'). Do not switch to English sentences or Malayalam script."
    ),
}


def _resolve_language_instruction(language):
    key = (language or 'english').strip().lower()
    return LANGUAGE_INSTRUCTIONS.get(key, LANGUAGE_INSTRUCTIONS['english'])

def _build_customer_report_prompt(data, language='english'):
    return f"""You are writing an internal project-status report for a solar
installation company. The reader is a super admin who oversees every
customer and every staff member - they need to understand this project's
health in the first few seconds, then drill into details if they choose to.

FORMATTING RULES (follow strictly):
- Plain text only. No markdown symbols like **, ##, *, -.
- Never start a line with a number followed by a period or bracket (no
  "1.", "1)", "2.", etc.) anywhere in the report, including in the module
  list and the next-steps list. Write module names and steps as plain
  lines or short paragraphs instead, without any numbering.
- Keep sentences short. Keep paragraphs to 2-3 sentences max.
- Leave one blank line between every section and between the section
  heading and its content, so the report is easy to scan, not one dense
  block of text.
- Section headings should be short, in plain capital letters, on their
  own line (e.g. EXECUTIVE SUMMARY), with a blank line before and after.

CRITICAL - WRITE IN PLAIN HUMAN LANGUAGE, NEVER DUMP RAW DATA:
- Never print a JSON/database field name in the report (e.g. never write
  "work_done", "advance_amount", "mnre_status", "is_overdue",
  "reopen_count", or any other snake_case key, and never write
  "field_name: value" pairs).
- Translate every fact into a natural sentence instead. For example,
  instead of "advance_amount: 0.0, total_amount: 0.0" write "no advance
  payment has been received yet". Instead of "work_done: Pending" write
  "this module is still pending". Instead of "is_overdue: true" write
  "this complaint has crossed its due date".
- Only mention a number, amount, or date when it is meaningful to a
  reader (e.g. an actual payment amount, a real date) - do not restate
  every zero/false/null field individually. If most fields in a module
  are empty or zero, just say the module hasn't been started or has no
  meaningful progress yet, in one line - do not list each empty field.

Structure the report in this exact order:

EXECUTIVE SUMMARY (4-6 short lines)
Customer name, ID, district, place, capacity (kW). Overall project status
in one line (e.g. "On track", "Delayed", "Stalled - awaiting customer
action", "Nearing completion"). How many of the 11 modules are complete
versus pending, in plain words. The single biggest risk or blocker right
now, or say there are none.

MODULE-BY-MODULE STATUS
Cover each of the 11 modules in this fixed order, each as its own short
paragraph (module name as a plain line, no numbering): Site Visit, MNRE
Profile, Payment Flow, Bank Loan, KSEB Feasibility, Material Delivery,
Material Installation, KSEB Registration & Completion, DCR, MNRE
Installation, Service & Maintenance.
Use each module's completion signal in the data as the authoritative
source for whether it's complete or pending, but describe it in plain
words ("this module is complete", "still pending"), never by naming the
field. Mention one or two genuinely notable details per module in plain
language (an amount, a date, a comment) only if present and meaningful.
If a module's data is null, say it hasn't been started yet - do not
guess why, and do not list every missing sub-field.
For Bank Loan specifically: if the data shows the customer did not need
a loan, say plainly that no loan was required - do not describe this as
a completed loan process, since those are different things.

COMPLAINTS
Summarize the complaints for this customer in plain language: how many
total, how many are open versus resolved versus closed, and mention if
any have crossed their due date or were reopened - describe this in
words, not field names. If there are no complaints, say so in one line.

RISKS & GAPS
Call out anything overdue, inconsistent, or missing that a super admin
should know about even if no one flagged it, in plain sentences. Base
this only on the data, including the audit log if it shows unusual gaps
in activity.

RECOMMENDED NEXT STEPS
Write 2-4 concrete, prioritized actions as plain lines (no numbering) -
what should happen next and who this likely depends on (customer, staff,
KSEB, MNRE, etc.), based only on what the data shows.

Only use facts present in the data below - never invent figures, dates, or
reasons for delay that aren't supported by the data.

LANGUAGE INSTRUCTION: {_resolve_language_instruction(language)}
(Keep numbers, dates, module names, and proper nouns as-is; apply the
language instruction to the surrounding sentences/prose.)

DATA:
{json.dumps(data, indent=2, default=_json_default)}
"""


def _build_staff_report_prompt(data, language='english'):
    return f"""You are writing an internal staff performance report for a
solar installation company. The reader is a super admin reviewing many
staff members - they need a clear verdict on this person's performance in
the reporting period, then supporting detail.

FORMATTING RULES (follow strictly):
- Plain text only. No markdown symbols like **, ##, *, -.
- Never start a line with a number followed by a period or bracket (no
  "1.", "1)", "2.", etc.) anywhere in the report. Write observations and
  next steps as plain lines or short paragraphs, without any numbering.
- Keep sentences short. Keep paragraphs to 2-3 sentences max.
- Leave one blank line between every section and between the section
  heading and its content, so the report is easy to scan, not one dense
  block of text.
- Section headings should be short, in plain capital letters, on their
  own line (e.g. EXECUTIVE SUMMARY), with a blank line before and after.

CRITICAL - WRITE IN PLAIN HUMAN LANGUAGE, NEVER DUMP RAW DATA:
- Never print a JSON/database field name in the report (e.g. never write
  "resolved_at", "is_overdue", "reopen_count", or any other snake_case
  key, and never write "field_name: value" pairs).
- Translate every fact into a natural sentence instead. Only mention a
  specific number or date when it's meaningful to the reader (e.g. "5
  site visits were completed") - do not restate raw data field by field.

Structure the report in this exact order:

EXECUTIVE SUMMARY (4-6 short lines)
Staff name, role, department, and the exact reporting period covered.
One-line performance verdict (e.g. "Strong, consistent activity",
"Below-average output this period", "Mostly reactive - low proactive
activity", "Insufficient data to assess"). Headline numbers in plain
words: total activity logged, site visits handled, complaints assigned
versus resolved.

ACTIVITY DURING THE PERIOD
Volume and nature of activity logged, and site visits handled - what was
done, and any patterns worth noting (bursts of activity, gaps, etc.),
described in plain language.

COMPLAINT HANDLING
Complaints assigned versus resolved during the period, and how promptly,
in plain language - flag anything left unresolved or resolved slowly.

OBSERVATIONS FOR MANAGEMENT
Write 2-4 specific, evidence-based observations or recommendations as
plain lines (no numbering) that a super admin should act on or keep an
eye on. Do not speculate about the person's motivation or effort - only
describe what the data shows.

Only use facts present in the data below - never invent figures or dates.
If a section has no data, say plainly that no activity was recorded for
that period, rather than guessing why.

LANGUAGE INSTRUCTION: {_resolve_language_instruction(language)}
(Keep numbers, dates, module names, and proper nouns as-is; apply the
language instruction to the surrounding sentences/prose.)

DATA:
{json.dumps(data, indent=2, default=_json_default)}
"""

def generate_gemini_report(data, report_type, language='english', model_name='gemini-3.6-flash',
                            max_retries=3):
    """
    report_type: 'customer' or 'staff'.
    language: 'english' | 'malayalam' | 'hindi' | 'manglish'.
    Returns the report as plain text.
    """
    client = _get_gemini_client()

    if report_type == 'customer':
        prompt = _build_customer_report_prompt(data, language=language)
    elif report_type == 'staff':
        prompt = _build_staff_report_prompt(data, language=language)
    else:
        raise ValueError(f"Unknown report_type: {report_type}")

    last_error = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(model=model_name, contents=prompt)
            return response.text
        except genai_errors.ServerError as e:
            # 503 UNAVAILABLE / occasional 429s are transient overload - back off and retry.
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # 1s, 2s, 4s
            continue

    raise RuntimeError(
        "Gemini is currently experiencing high demand. Please try generating the report again in a minute."
    ) from last_error