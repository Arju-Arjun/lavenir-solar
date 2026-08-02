import re
import json
import threading
from datetime import datetime
import cloudinary
import cloudinary.uploader
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func, or_, and_, text
from sqlalchemy.exc import IntegrityError
from models import (db, CustomerProject, CustomerAuditLog, User, UserPermission, PermissionRequest,
                    BankLoan,
                    Payment,
                    DCRCertificate,
                    KSEB, 
                    MNREInstallation, 
                    MNREProfile,
                    KsebRegistrationCompletion,
                    Service, 
                    MaterialDelivery, 
                    MaterialDeliveryItem,
                    MaterialInstallation,
                    SiteVisit)

customers_bp = Blueprint('customers', __name__)

def delete_cloudinary_image(image_url): 
    if not image_url or "res.cloudinary.com" not in image_url or "sample.jpg" in image_url:
        return 
    try: 
        pattern = r"/v\d+/(.+)\.[a-zA-Z0-9]+$" 
        match = re.search(pattern, image_url) 
        if match: 
            public_id = match.group(1)
            cloudinary.uploader.destroy(public_id)
            print(f"Successfully removed old Cloudinary asset: {public_id}")
    except Exception as e: 
        print(f"Cloudinary file removal skipped or failed: {str(e)}")


# ==========================================
# CUSTOMER DELETE — TRASH INSTEAD OF DESTROY (added)
# ==========================================
# Requirement: when a customer profile is deleted, every document/image
# belonging to that customer across every module (site visit, payment, KSEB,
# DCR, material delivery/installation, services, etc.) should NOT be
# permanently destroyed on Cloudinary. Instead it should be moved into a
# 'lavenir/trash/...' folder (created automatically by Cloudinary the first
# time something is renamed into it — no separate setup needed) so it can
# still be recovered later if needed.

TRASH_FOLDER = "lavenir/trash"


def move_cloudinary_to_trash(file_url):
    """
    Moves a single Cloudinary asset into TRASH_FOLDER instead of deleting it,
    preserving its original folder structure underneath, e.g.:
        lavenir/JohnDoe_1023/sitevisit/adhar_1023.jpg
        -> lavenir/trash/JohnDoe_1023/sitevisit/adhar_1023.jpg
    Returns the new secure_url on success, or None if nothing was moved.
    """
    if not file_url or "res.cloudinary.com" not in file_url or "sample.jpg" in file_url:
        return None
    try:
        pattern = r"/upload/(?:v\d+/)?(.+)\.[a-zA-Z0-9]+$"
        match = re.search(pattern, file_url)
        if not match:
            return None
        public_id = match.group(1)

        # Already sitting in trash (e.g. re-triggered delete) — leave it alone.
        if public_id.startswith(TRASH_FOLDER + "/"):
            return None

        new_public_id = f"{TRASH_FOLDER}/{public_id}"
        result = cloudinary.uploader.rename(public_id, new_public_id, overwrite=True)
        print(f"Moved Cloudinary asset to trash: {public_id} -> {new_public_id}")
        return result.get("secure_url")
    except Exception as e:
        print(f"Cloudinary trash-move skipped or failed for {file_url}: {str(e)}")
        return None


def _collect_json_list_urls(json_text, into):
    if not json_text:
        return
    try:
        parsed = json.loads(json_text)
        if isinstance(parsed, list):
            into.extend([u for u in parsed if u])
    except Exception:
        pass


def collect_customer_cloudinary_urls(customer):
    """
    Walks every module attached to a CustomerProject and pulls out every
    Cloudinary file/image URL stored on it. Must be called BEFORE the
    customer row is deleted — once db.session.delete(customer) cascades,
    these rows (and their URLs) are gone from the DB.
    """
    urls = []
    if customer.profile_photo:
        urls.append(customer.profile_photo)

    for visit in customer.site_visits:
        for field in ('quotation_file', 'agreement_file', 'aadhaar', 'pan',
                      'kseb_bill', 'bank_passbook', 'land_tax',
                      'building_tax', 'signature'):
            value = getattr(visit, field, None)
            if value:
                urls.append(value)
        _collect_json_list_urls(visit.images, urls)

    if customer.mnre_profile_rel:
        if customer.mnre_profile_rel.feasibility_file:
            urls.append(customer.mnre_profile_rel.feasibility_file)
        if customer.mnre_profile_rel.ack_file:
            urls.append(customer.mnre_profile_rel.ack_file)

    if customer.bank_loan_rel and customer.bank_loan_rel.acknowledgement_file:
        urls.append(customer.bank_loan_rel.acknowledgement_file)

    if customer.payment_rel and customer.payment_rel.proof_file:
        urls.append(customer.payment_rel.proof_file)

    if customer.dcr_certificate_rel and customer.dcr_certificate_rel.certificate_file:
        urls.append(customer.dcr_certificate_rel.certificate_file)

    for service in customer.services:
        _collect_json_list_urls(service.images, urls)

    if customer.material_delivery_rel:
        if customer.material_delivery_rel.delivery_document:
            urls.append(customer.material_delivery_rel.delivery_document)
        _collect_json_list_urls(customer.material_delivery_rel.delivery_images, urls)

    if customer.material_installation_rel:
        if customer.material_installation_rel.installation_document:
            urls.append(customer.material_installation_rel.installation_document)
        _collect_json_list_urls(customer.material_installation_rel.installation_images, urls)

    return urls


CUSTOMER_PROFILE_MODULE = 'Customer Profile'

PHONE_PATTERN = re.compile(r'^\d{10}$')


def check_staff_action_permission(user_id, role, tier_needed):
    """Evaluates granular permissions against the JSON storage matrix column for staff accounts."""
    if role == 'admin':
        return True
        
    matrix_record = UserPermission.query.filter_by(user_id=user_id).first()
    if not matrix_record:
        return False
        
    try:
        matrix = json.loads(matrix_record.permissions_matrix)
    except Exception:
        return False
        
    # Customer Profile permissions must be checked against the 'Customer Profile'
    # module key, matching PermissionManagement.jsx's systemModules list — not
    # 'Site Visit', which is a separate, independently-managed module.
    module_permissions = matrix.get(CUSTOMER_PROFILE_MODULE, {})
    return module_permissions.get(tier_needed, False)


def get_next_sl_no():
    """
    Allocates the next sl_no from a Postgres sequence (customer_sl_no_seq)
    instead of SELECT MAX(sl_no) + 1.

    Why: MAX()+1 is a read-then-write race. Two concurrent create_customer
    requests can both read the same MAX before either commits, both compute
    the same next_sl/customer_id, and the second insert's unique-constraint
    flush() fails. The previous retry loop only got 2 attempts total, so
    under any real concurrency (e.g. two staff adding customers around the
    same time) this surfaced to the user as:
    "Could not allocate a unique customer ID; please retry." (HTTP 409)

    nextval() on a sequence is atomic at the DB level — Postgres guarantees
    two concurrent callers never receive the same value, with no row
    locking or retry logic required.

    One-time setup (run once against the DB, e.g. via an Alembic migration):

        CREATE SEQUENCE IF NOT EXISTS customer_sl_no_seq;
        SELECT setval('customer_sl_no_seq',
                       COALESCE((SELECT MAX(sl_no) FROM customer_projects), 0));
    """
    return db.session.execute(text("SELECT nextval('customer_sl_no_seq')")).scalar()


# ---------------------------------------------------------------------------
# OPTIMIZATION: work_done() used to run 10 separate queries PER customer
# (1 + 10N queries for a list of N customers — 2,000+ queries for 200 rows).
# get_work_done_map() below runs 10 queries TOTAL for the whole list, using
# .in_(customer_ids) to batch-fetch each related table once.
# ---------------------------------------------------------------------------

WORK_DONE_MODELS = [
    SiteVisit, MNREProfile, KSEB, KsebRegistrationCompletion, BankLoan,
    DCRCertificate, MaterialInstallation, MaterialDelivery, Payment, MNREInstallation
]


def get_work_done_map(customer_ids):
    """
    Batch version of the old per-customer work_done() lookup.
    Returns: { customer_project_id: { "sitevisit": "Completed"/"Pending", ... } }
    Runs len(WORK_DONE_MODELS) queries total, regardless of how many customers.
    """
    result = {cid: {} for cid in customer_ids}

    if not customer_ids:
        return result

    for model in WORK_DONE_MODELS:
        rows = model.query.filter(model.customer_project_id.in_(customer_ids)).all()
        class_name = model.__name__.lower()
        for row in rows:
            status = "Completed" if getattr(row, 'work_done', None) == "Completed" else "Pending"
            result[row.customer_project_id][class_name] = status

    return result


def work_done(customer):
    """
    Kept for backward compatibility (e.g. if a single-customer route still
    calls this). For LIST endpoints, use get_work_done_map() instead —
    calling this per-row in a loop reintroduces the N+1 problem.
    """
    work_done_map = get_work_done_map([customer.id])
    return work_done_map.get(customer.id, {})


@customers_bp.route('/', methods=['POST'])
@jwt_required()
def create_customer():
    try:
        
        current_user_id = get_jwt_identity()
        
        customer_name = request.form.get('customer_name')
        email = request.form.get('email')
        phone_number = request.form.get('phone_number')
        district = request.form.get('district')
        place = request.form.get('place') or ""
        capacity_kw = request.form.get('capacity_kw', '0.00')
        

        if not all([customer_name, phone_number, district]):
            return jsonify({
                "success": False, 
                "message": "Required fields are missing (Name, Phone, District, and Place)."
            }), 400

        if not PHONE_PATTERN.match(phone_number):
            return jsonify({
                "success": False,
                "message": "Invalid mobile number format. Must be 10 digits."
            }), 400

        try:
            parsed_capacity = float(capacity_kw) if capacity_kw not in (None, '') else 0.00
        except (ValueError, TypeError):
            return jsonify({
                "success": False,
                "message": "Invalid capacity_kw value; must be numeric."
            }), 400

        profile_photo_url = "https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg"
        if 'profile_photo' in request.files:
            file_to_upload = request.files['profile_photo']
            if file_to_upload.filename != '':
                try:
                    upload_result = cloudinary.uploader.upload(file_to_upload, folder="solar_profiles")
                except Exception as upload_err:
                    return jsonify({
                        "success": False,
                        "message": f"Profile photo upload failed: {str(upload_err)}"
                    }), 502
                profile_photo_url = upload_result.get('secure_url')

        # today = datetime.utcnow()

        # date_prefix = today.strftime("%y%m%d")

        # Retry once on a unique-constraint collision (e.g. a concurrent
        # request grabbed the same sl_no between our lookup and our insert).
        # This keeps the common case fast (no locking) while still handling
        # the rare race instead of surfacing a raw 500.
        max_attempts = 2
        for attempt in range(1, max_attempts + 1):
            next_sl = get_next_sl_no()
            generated_id = f"CUS{next_sl:03d}"

            new_customer = CustomerProject(
                customer_id=generated_id,
                customer_name=customer_name.capitalize(),
                profile_photo=profile_photo_url,
                email=email if email else None,
                phone_number=phone_number,
                district=district.capitalize(),
                place=place.capitalize(),
                capacity_kw=parsed_capacity,
                sl_no=next_sl
            )

            db.session.add(new_customer)

            try:
                db.session.flush()
            except IntegrityError:
                db.session.rollback()
                if attempt < max_attempts:
                    continue
                return jsonify({
                    "success": False,
                    "message": "Could not allocate a unique customer ID; please retry."
                }), 409
            else:
                break

        print(f"\n\n\n\n\n\n\n parsed_capacity: {parsed_capacity} \n\n\n\n\n\n\n")
        # ADDED (Option B): auto-create one "shell" status row per SINGLETON
        # work module for every new customer, so the dashboard sees this
        # customer as Pending in every module from day one instead of being
        # invisible until someone fills in a real Payment/KSEB
        # Registration/etc. form for them.
        #
        # Each row is created with its OWN model defaults left untouched
        # (e.g. BankLoan.work_done still defaults to "Completed" since a loan
        # isn't needed by default) — this only creates the row, it never
        # changes what "pending" vs "complete" means for that module.
        #
        # DELIBERATELY EXCLUDED: Site Visit (SiteVisit) and KSEB (KSEB) —
        # see the comment block just above this one for why a SiteVisit
        # stub was removed already (it broke check_feasibility_delay's 30s/
        # 20-day timer by starting it from customer *creation* instead of
        # the real site visit). KSEB has the exact same shape - a one-to-many
        # `kseb_records` log, not a per-customer singleton row - so it's
        # excluded for the same reason: a synthetic KSEB entry would sit in
        # that customer's KSEB history before any human ever touched it.
        # Every module below IS a true one-row-per-customer singleton
        # (uselist=False / unique=True on customer_project_id), so a stub
        # here doesn't corrupt any history - it just marks "not started yet"
        # the same way the customer profile itself already does.
        db.session.add(MNREProfile(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(MNREInstallation(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(BankLoan(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(Payment(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(KsebRegistrationCompletion(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(DCRCertificate(customer_project_id=new_customer.id, created_by=current_user_id))
        db.session.add(MaterialDelivery(
            customer_project_id=new_customer.id,
            created_by=current_user_id,
            # delivery_date is NOT NULL with no column default, so a
            # placeholder is unavoidable here. This does NOT mean delivery
            # has happened - electrical_delivered / panel_delivered /
            # structure_delivered / work_done all stay at their own
            # defaults (False / "Pending"), which is what every
            # delivery-related check in notification_rules.py actually
            # reads (e.g. check_dcr_delay checks delivery.panel_delivered,
            # not delivery_date).
            delivery_date=datetime.utcnow().date(),
        ))
        db.session.add(MaterialInstallation(customer_project_id=new_customer.id, created_by=current_user_id))

        # REMOVED: previously auto-created a `default_site_visit` SiteVisit
        # row here, right at customer-creation time. That made
        # check_feasibility_delay() (notification_rules.py) start its 30s/
        # 20-day timer from customer *creation*, since it keys off
        # SiteVisit.created_at of the latest site_visits row - not from when
        # staff actually fill in and submit the real Site Visit form via
        # save_site_visit() (site_visit.py), which only ever UPDATES this
        # same row rather than creating a new one. Net effect: the
        # "KSEB Feasibility Pending" alert fired almost immediately after a
        # customer was created, before any real site visit had happened.
        # Now no SiteVisit row exists until save_site_visit() creates the
        # first one for real, so the feasibility-delay clock starts at the
        # correct time.

        audit_payload = {
            "customer_name": customer_name,
            "email": email,
            "phone_number": phone_number,
            "district": district,
            "place": place,
            "capacity_kw": parsed_capacity
        }
        audit_log = CustomerAuditLog(
            customer_project_id=new_customer.id,
            user_id=current_user_id,
            action="CREATE",
            module_name="Customer Profile",
            changes_payload=json.dumps(audit_payload)
        )
        db.session.add(audit_log)

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Customer profile created successfully!",
            "data": new_customer.to_dict()
        }), 201

    except IntegrityError as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": "A record with conflicting unique fields already exists. Please retry."
        }), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": f"Creation failed: {str(e)}"
        }), 500


CAPACITY_TOLERANCE = 0.001  # Numeric(10,2) equality tolerance for kW comparisons


def _capacity_match(column, value, custom_value):
    """
    Builds a boolean SQLAlchemy expression for a capacity dropdown
    (3 / 5 / 8 / 10 / other). Returns None if the filter wasn't set or is
    incomplete (e.g. "other" chosen but no custom value typed), in which
    case the caller should skip applying it rather than filtering out
    every row.
    """
    if not value:
        return None
    raw = custom_value if value == 'other' else value
    try:
        target = float(raw)
    except (TypeError, ValueError):
        return None
    return func.abs(column - target) < CAPACITY_TOLERANCE


def _yes_no(value):
    """Normalizes a TriStateSelect value ('yes'/'no'/'') to True/False/None."""
    if value == 'yes':
        return True
    if value == 'no':
        return False
    return None


def _ids_matching(model, condition):
    """Returns a scalar subquery of customer_project_id for rows in `model`
    satisfying `condition`. Used to filter CustomerProject.id.in_(...) so a
    customer with multiple related rows (e.g. several Site Visits) is never
    duplicated by a join."""
    return db.session.query(model.customer_project_id).filter(condition)


def apply_advanced_filters(query, filters):
    """
    Applies the nested advanced-filter tree (see AdvancedFilterPanel.jsx for
    the exact shape) on top of the base CustomerProject query.

    Each category is translated into an `CustomerProject.id.in_(<subquery>)`
    clause rather than a SQL JOIN, so a customer with more than one row in a
    related table (e.g. multiple Site Visits) can never be duplicated in the
    result set.

    Returns (query, warnings) — warnings lists any bank-loan payment-based
    sub-filters that must be applied as a second pass in Python, since they
    depend on parsing the loan_payments JSON column and can't be expressed
    as a plain SQL comparison.
    """
    post_filters = {}

    # ---- Profile -----------------------------------------------------
    profile = filters.get('profile', {})
    cap_cond = _capacity_match(
        CustomerProject.capacity_kw,
        profile.get('system_capacity', ''),
        profile.get('system_capacity_custom', '')
    )
    if cap_cond is not None:
        query = query.filter(cap_cond)
    if profile.get('district'):
        query = query.filter(CustomerProject.district == profile['district'])

    # ---- Site Visit ----------------------------------------------------
    sv = filters.get('site_visit', {})
    sv_conditions = []
    panel_cond = _capacity_match(SiteVisit.panel_capacity, sv.get('panel_capacity', ''), sv.get('panel_capacity_custom', ''))
    if panel_cond is not None:
        sv_conditions.append(panel_cond)
    sys_cond = _capacity_match(SiteVisit.system_capacity, sv.get('system_capacity', ''), sv.get('system_capacity_custom', ''))
    if sys_cond is not None:
        sv_conditions.append(sys_cond)
    if _yes_no(sv.get('load_enhancement')) is True:
        sv_conditions.append(SiteVisit.load_enhancement == 'Yes')
    elif _yes_no(sv.get('load_enhancement')) is False:
        sv_conditions.append(SiteVisit.load_enhancement != 'Yes')
    if _yes_no(sv.get('ownership_change')) is True:
        sv_conditions.append(SiteVisit.ownership_change == 'Yes')
    elif _yes_no(sv.get('ownership_change')) is False:
        sv_conditions.append(SiteVisit.ownership_change != 'Yes')
    if _yes_no(sv.get('wifi')) is True:
        sv_conditions.append(SiteVisit.wifi == 'Yes')
    elif _yes_no(sv.get('wifi')) is False:
        sv_conditions.append(SiteVisit.wifi != 'Yes')
    if sv_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(SiteVisit, and_(*sv_conditions))))

    # ---- MNRE Profile (work_done) --------------------------------------
    mnre_status = _yes_no(filters.get('mnre_profile', {}).get('status'))
    if mnre_status is True:
        query = query.filter(CustomerProject.id.in_(_ids_matching(MNREProfile, MNREProfile.work_done == 'Completed')))
    elif mnre_status is False:
        query = query.filter(CustomerProject.id.in_(_ids_matching(MNREProfile, MNREProfile.work_done != 'Completed')))

    # ---- Payment (work_done) -------------------------------------------
    payment_status = _yes_no(filters.get('payment', {}).get('status'))
    if payment_status is True:
        query = query.filter(CustomerProject.id.in_(_ids_matching(Payment, Payment.work_done == 'Completed')))
    elif payment_status is False:
        query = query.filter(CustomerProject.id.in_(_ids_matching(Payment, Payment.work_done != 'Completed')))

    # ---- Bank Loan -------------------------------------------------------
    # `required` and `jansamarth` are plain columns, filtered here in SQL.
    # `first_payment` / `second_payment` depend on the loan_payments JSON
    # array and BankLoan.due_amount, so they're handled as a Python-side
    # post-filter after the main query runs (see get_customers()).
    bl = filters.get('bank_loan', {})
    bl_conditions = []
    required = _yes_no(bl.get('required'))
    if required is True:
        bl_conditions.append(BankLoan.need_loan.is_(True))
    elif required is False:
        bl_conditions.append(BankLoan.need_loan.is_(False))
    jansamarth = _yes_no(bl.get('jansamarth'))
    if jansamarth is True:
        bl_conditions.append(BankLoan.jansamarth_status == 'Completed')
    elif jansamarth is False:
        bl_conditions.append(BankLoan.jansamarth_status != 'Completed')
    if bl_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(BankLoan, and_(*bl_conditions))))
    if bl.get('first_payment') or bl.get('second_payment'):
        post_filters['bank_loan_payments'] = {
            'first_payment': _yes_no(bl.get('first_payment')),
            'second_payment': _yes_no(bl.get('second_payment'))
        }

    # ---- KSEB Feasibility ------------------------------------------------
    # ownership_status / load_enhancement_status aren't tightly enumerated
    # in the model, so "complete" matches case-insensitively on the word
    # "complete" and "pending" matches everything else (including blank).
    kf = filters.get('kseb_feasibility', {})
    kf_conditions = []
    ownership = _yes_no(kf.get('ownership_change'))
    if ownership is True:
        kf_conditions.append(KSEB.ownership_status.ilike('%complete%'))
    elif ownership is False:
        kf_conditions.append(or_(KSEB.ownership_status.is_(None), ~KSEB.ownership_status.ilike('%complete%')))
    load_enh = _yes_no(kf.get('load_enhancement'))
    if load_enh is True:
        kf_conditions.append(KSEB.load_enhancement_status.ilike('%complete%'))
    elif load_enh is False:
        kf_conditions.append(or_(KSEB.load_enhancement_status.is_(None), ~KSEB.load_enhancement_status.ilike('%complete%')))
    feasibility = _yes_no(kf.get('feasibility'))
    if feasibility is True:
        kf_conditions.append(KSEB.feasibility_status.ilike('%complete%'))
    elif feasibility is False:
        kf_conditions.append(~KSEB.feasibility_status.ilike('%complete%'))
    fee_paid = _yes_no(kf.get('fee_paid'))
    if fee_paid is True:
        kf_conditions.append(KSEB.fee_paid.is_(True))
    elif fee_paid is False:
        kf_conditions.append(KSEB.fee_paid.is_(False))
    if kf_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(KSEB, and_(*kf_conditions))))

    # ---- Material Delivery -------------------------------------------
    md = filters.get('material_delivery', {})
    md_conditions = []
    electrical = _yes_no(md.get('electrical'))
    if electrical is not None:
        md_conditions.append(MaterialDelivery.electrical_delivered.is_(electrical))
    structure = _yes_no(md.get('structure'))
    if structure is not None:
        md_conditions.append(MaterialDelivery.structure_delivered.is_(structure))
    panels = _yes_no(md.get('panels'))
    if panels is not None:
        md_conditions.append(MaterialDelivery.panel_delivered.is_(panels))
    if md_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(MaterialDelivery, and_(*md_conditions))))

    # ---- Material Installation -----------------------------------------
    mi = filters.get('material_installation', {})
    mi_conditions = []
    mi_electrical = _yes_no(mi.get('electrical'))
    if mi_electrical is not None:
        mi_conditions.append(MaterialInstallation.electrical_installed.is_(mi_electrical))
    mi_structure = _yes_no(mi.get('structure'))
    if mi_structure is not None:
        mi_conditions.append(MaterialInstallation.structure_installed.is_(mi_structure))
    if mi_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(MaterialInstallation, and_(*mi_conditions))))

    # ---- KSEB Registration & Completion ---------------------------------
    kr = filters.get('kseb_registration', {})
    kr_conditions = []
    reg = _yes_no(kr.get('registration_submitted'))
    if reg is not None:
        kr_conditions.append(KsebRegistrationCompletion.registration_submitted.is_(reg))
    comp = _yes_no(kr.get('completion_submitted'))
    if comp is not None:
        kr_conditions.append(KsebRegistrationCompletion.completion_submitted.is_(comp))
    agreement_payment = _yes_no(kr.get('agreement_payment_done'))
    if agreement_payment is True:
        kr_conditions.append(and_(
            KsebRegistrationCompletion.agreement_submitted.is_(True),
            KsebRegistrationCompletion.payment_done.is_(True)
        ))
    elif agreement_payment is False:
        kr_conditions.append(or_(
            KsebRegistrationCompletion.agreement_submitted.is_(False),
            KsebRegistrationCompletion.payment_done.is_(False)
        ))
    wifi_cfg = _yes_no(kr.get('wifi_configured'))
    if wifi_cfg is not None:
        kr_conditions.append(KsebRegistrationCompletion.wifi_configured.is_(wifi_cfg))
    if kr_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(KsebRegistrationCompletion, and_(*kr_conditions))))

    # ---- DCR --------------------------------------------------------------
    cert_sold = _yes_no(filters.get('dcr', {}).get('certificate_sold'))
    if cert_sold is not None:
        query = query.filter(CustomerProject.id.in_(_ids_matching(DCRCertificate, DCRCertificate.certificate_sold.is_(cert_sold))))

    # ---- MNRE Installation ------------------------------------------------
    mn = filters.get('mnre_installation', {})
    mn_conditions = []
    inst_status = _yes_no(mn.get('installation_status'))
    if inst_status is True:
        mn_conditions.append(MNREInstallation.installation_status == 'Completed')
    elif inst_status is False:
        mn_conditions.append(MNREInstallation.installation_status != 'Completed')
    appr_status = _yes_no(mn.get('approval_status'))
    if appr_status is True:
        mn_conditions.append(MNREInstallation.approval_status == 'Approved')
    elif appr_status is False:
        mn_conditions.append(MNREInstallation.approval_status != 'Approved')
    subs_status = _yes_no(mn.get('subsidy_status'))
    if subs_status is True:
        mn_conditions.append(MNREInstallation.subsidy_status == 'Approved')
    elif subs_status is False:
        mn_conditions.append(MNREInstallation.subsidy_status != 'Approved')
    if mn_conditions:
        query = query.filter(CustomerProject.id.in_(_ids_matching(MNREInstallation, and_(*mn_conditions))))

    # ---- Service (count range) -------------------------------------------
    service = filters.get('service', {})
    count_min = service.get('count_min')
    count_max = service.get('count_max')
    if count_min not in (None, '') or count_max not in (None, ''):
        counts_subq = (
            db.session.query(
                Service.customer_project_id.label('cpid'),
                func.count(Service.id).label('cnt')
            )
            .group_by(Service.customer_project_id)
            .subquery()
        )
        count_query = db.session.query(counts_subq.c.cpid)
        if count_min not in (None, ''):
            count_query = count_query.filter(counts_subq.c.cnt >= int(count_min))
        if count_max not in (None, ''):
            count_query = count_query.filter(counts_subq.c.cnt <= int(count_max))
        query = query.filter(CustomerProject.id.in_(count_query))

    return query, post_filters


def _bank_loan_payment_ok(bank_loan_dict, want_first, want_second):
    """
    Python-side check for the Bank Loan "1st Payment" / "2nd Payment"
    sub-filters, since they depend on parsing the loan_payments JSON array:
      - 1st Payment "completed": an entry labeled with "1st" has amount > 0
      - 2nd Payment "completed": an entry labeled with "2nd" has amount > 0
        AND the loan's due_amount is fully cleared (== 0)
    Adjust the label-matching / amount rules here if your labels differ.
    """
    payments = bank_loan_dict.get('loan_payments') or []

    def has_positive_payment(label_fragment):
        return any(
            label_fragment in str(p.get('label', '')).lower() and float(p.get('amount', 0)) > 0
            for p in payments
        )

    if want_first is not None:
        first_done = has_positive_payment('1st')
        if want_first != first_done:
            return False

    if want_second is not None:
        second_done = has_positive_payment('2nd') and float(bank_loan_dict.get('due_amount', 0)) == 0
        if want_second != second_done:
            return False

    return True


@customers_bp.route('/', methods=['GET'])
@jwt_required()
def get_customers():
    try:
        search_query = request.args.get('search', '').strip()
        sort_by = request.args.get('sort_by', 'created_date').strip()
        sort_order = request.args.get('sort_order', 'desc').strip()

        # Nested advanced filters (Profile, Site Visit, Bank Loan, KSEB, ...),
        # sent as a JSON-encoded string in ?filters=. See AdvancedFilterPanel.jsx
        # for the exact shape and apply_advanced_filters() above for how each
        # category is translated into a query condition.
        raw_filters = request.args.get('filters', '').strip()
        try:
            advanced_filters = json.loads(raw_filters) if raw_filters else {}
            if not isinstance(advanced_filters, dict):
                advanced_filters = {}
        except (ValueError, TypeError):
            return jsonify({"success": False, "error": "Invalid filters payload; expected JSON."}), 400

        # OPTIMIZATION: pagination is opt-in so existing frontend calls that
        # don't send page/per_page keep working exactly as before (returns
        # all matching rows). Once your frontend list view is updated to
        # send ?page=1&per_page=25, this kicks in and avoids loading the
        # entire table on every request.
        page = request.args.get('page', type=int)
        per_page = request.args.get('per_page', default=25, type=int)

        query = CustomerProject.query

        if search_query:
            query = query.filter(
                (CustomerProject.customer_name.ilike(f'%{search_query}%')) |
                (CustomerProject.place.ilike(f'%{search_query}%'))
            )

        post_filters = {}
        if advanced_filters:
            query, post_filters = apply_advanced_filters(query, advanced_filters)

        # Bank Loan's "1st Payment" / "2nd Payment" sub-filters need the
        # loan_payments JSON parsed, so they run as a second pass here: pull
        # the candidate ids the SQL-level filters already narrowed down to,
        # check each one's BankLoan row in Python, then re-filter the query.
        if 'bank_loan_payments' in post_filters:
            candidate_ids = [row.id for row in query.with_entities(CustomerProject.id).all()]
            passing_ids = []
            if candidate_ids:
                loan_rows = BankLoan.query.filter(BankLoan.customer_project_id.in_(candidate_ids)).all()
                wants = post_filters['bank_loan_payments']
                for loan in loan_rows:
                    if _bank_loan_payment_ok(loan.to_dict(), wants['first_payment'], wants['second_payment']):
                        passing_ids.append(loan.customer_project_id)
            query = query.filter(CustomerProject.id.in_(passing_ids))

        if sort_by == 'customer_name':
            sort_column = CustomerProject.customer_name
        else:
            sort_column = CustomerProject.created_date

        if sort_order == 'desc':
            query = query.order_by(sort_column.desc())
        else:
            query = query.order_by(sort_column.asc())

        pagination_meta = None
        if page:
            paginated = query.paginate(page=page, per_page=per_page, error_out=False)
            records = paginated.items
            pagination_meta = {
                "page": paginated.page,
                "per_page": per_page,
                "total": paginated.total,
                "pages": paginated.pages
            }
        else:
            records = query.all()

        # OPTIMIZATION: single batched lookup instead of calling work_done()
        # once per customer (which was 10 queries x N customers). This also
        # removes the old O(N^2) "find matching dict" scan.
        customer_ids = [c.id for c in records]
        work_done_map = get_work_done_map(customer_ids)

        serialized_records = []
        for customer in records:
            customer_dict = customer.to_dict()
            
            # Append work_done statuses
            for key, value in work_done_map.get(customer.id, {}).items():
                customer_dict[f"{key}_work_done"] = value
                
            # ADD THIS LINE: Pass 'need_loan' to the frontend so the workflow diagram knows
            customer_dict['need_loan'] = customer.bank_loan_rel.need_loan if customer.bank_loan_rel else False

            serialized_records.append(customer_dict)

        response = {
            "success": True,
            "count": len(serialized_records),
            "data": serialized_records
        }
        if pagination_meta:
            response["pagination"] = pagination_meta

        return jsonify(response), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@customers_bp.route('/<string:customer_id>', methods=['GET'])
@jwt_required()
def get_customer_profile(customer_id):
    try:
        customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
        if not customer:
            return jsonify({
                "success": False,
                "message": f"Project record matching ID {customer_id} could not be resolved."
            }), 404

        return jsonify({
            "success": True,
            "data": customer.to_dict()
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@customers_bp.route('/<string:customer_id>', methods=['PUT'])
@jwt_required()
def update_customer_profile(customer_id):
    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"success": False, "message": "Customer profile not found"}), 404

    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)

        if not user:
            return jsonify({"success": False, "message": "Operator profile missing"}), 404

        # Enforce authorization rules on update tracking shifts
        if not check_staff_action_permission(user.id, user.role, 'update'):
            return jsonify({"success": False, "message": "Security Error: Write privileges absent."}), 403

        changes = {}

        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            if 'profile_photo' in request.files:
                file = request.files['profile_photo']
                upload_result = cloudinary.uploader.upload(file, folder="solar_profiles")
                if customer.profile_photo:
                    delete_cloudinary_image(customer.profile_photo)
                changes["profile_photo"] = {"old": customer.profile_photo, "new": upload_result.get("secure_url")}
                customer.profile_photo = upload_result.get("secure_url")
        else:
            data = request.get_json() or {}
            if 'profile_photo' in data and data['profile_photo'] != customer.profile_photo:
                if customer.profile_photo:
                    delete_cloudinary_image(customer.profile_photo)
                changes["profile_photo"] = {"old": customer.profile_photo, "new": data['profile_photo']}
                customer.profile_photo = data['profile_photo']

        #mobile number validation
        if 'phone_number' in data:
            if not PHONE_PATTERN.match(data['phone_number']):
                return jsonify({"success": False, "message": "Invalid mobile number format. Must be 10 digits."}), 400
            

        for field in ['customer_name', 'email', 'phone_number', 'district', 'place', 'project_status']:
            if field in data and getattr(customer, field) != data[field]:
                changes[field] = {"old": getattr(customer, field), "new": data[field]}
                setattr(customer, field, data[field])

        if 'capacity_kw' in data and data['capacity_kw'] != '':
            try:
                new_capacity = float(data['capacity_kw'])
            except (ValueError, TypeError):
                return jsonify({"success": False, "message": "Invalid capacity_kw value; must be numeric."}), 400
            if float(customer.capacity_kw) != new_capacity:
                changes['capacity_kw'] = {"old": float(customer.capacity_kw), "new": new_capacity}
                customer.capacity_kw = new_capacity
                visit = SiteVisit.query.filter_by(customer_project_id=customer.id).first()
                if visit:
                    visit.system_capacity = new_capacity
                    cp=SiteVisit(customer_project_id=customer.id,
                                 system_capacity=new_capacity)
                    db.session.add(cp)

        if changes:
            audit_log = CustomerAuditLog(
                customer_project_id=customer.id,
                user_id=current_user_id,
                action="UPDATE",
                module_name="Customer Profile",
                changes_payload=json.dumps(changes)
            )
            db.session.add(audit_log)

        db.session.commit()
        return jsonify({
            "success": True, 
            "message": "Profile updated successfully!",
            "data": customer.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": f"Update failed: {str(e)}"}), 500


@customers_bp.route('/<string:customer_id>', methods=['DELETE'])
@jwt_required()
def delete_customer_profile(customer_id):
    customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
    if not customer:
        return jsonify({"success": False, "message": "Customer profile not found"}), 404

    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)

        if not user:
            return jsonify({"success": False, "message": "Operator profile missing"}), 404

        # Enforce authorization rules on destructive drop shifts
        if not check_staff_action_permission(user.id, user.role, 'delete'):
            return jsonify({"success": False, "message": "Security Error: Destructive access denied."}), 403

        # Gather every document/image URL across ALL modules (site visit,
        # payment, bank loan, MNRE, KSEB registration, DCR, material
        # delivery/installation, services...) BEFORE deleting the customer —
        # once db.session.delete(customer) cascades, those rows are gone.
        file_urls = collect_customer_cloudinary_urls(customer)

        # db.session.delete(customer) cascades to every related module row
        # (site_visits, payment_rel, bank_loan_rel, kseb_records,
        # kseb_registration_rel, dcr_certificate_rel, mnre_profile_rel,
        # mnre_installation_rel, material_delivery_rel,
        # material_installation_rel, services, audit_logs) because each of
        # those relationships is declared with cascade="all, delete-orphan"
        # in models.py.
        db.session.delete(customer)
        db.session.commit()

        # Move the files to Cloudinary trash AFTER the DB commit succeeds,
        # so a Cloudinary hiccup never blocks the actual customer deletion.
        # Run it in a background thread so the HTTP response (and the
        # frontend's "Processing..." spinner) doesn't wait on N network
        # calls to Cloudinary — the DB delete is already committed at this
        # point, so there's nothing left for the request to wait on.
        if file_urls:
            threading.Thread(
                target=lambda urls=file_urls: [move_cloudinary_to_trash(u) for u in urls],
                daemon=True
            ).start()

        return jsonify({
            "success": True, 
            "message": "Customer account and all associated modules successfully deleted"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": f"Deletion failed: {str(e)}"}), 500


@customers_bp.route('/<string:customer_id>/permissions', methods=['GET'])
@jwt_required()
def get_customer_tab_permissions(customer_id):
    """Exposes permissions matrix validation context down to frontend view mode dashboards."""
    try:
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user:
            return jsonify({"error": "Operator profile missing"}), 404

        permissions = {
            "view": check_staff_action_permission(user.id, user.role, 'view'),
            "update": check_staff_action_permission(user.id, user.role, 'update'),
            "delete": check_staff_action_permission(user.id, user.role, 'delete')
        }

        pending_reqs = PermissionRequest.query.filter_by(user_id=user.id, module_name=CUSTOMER_PROFILE_MODULE, status='Pending').all()
        requests_map = {req.permission_type: "Pending" for req in pending_reqs}

        return jsonify({
            "permissions": permissions,
            "requests": requests_map
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@customers_bp.route('/<string:customer_id>/request-access', methods=['POST'])
@jwt_required()
def request_customer_profile_access(customer_id):
    """Hooks dynamic upgrade overrides straight up into administrative workspace panels."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json() or {}
        requested_tier = data.get('requested_tier') 

        if requested_tier not in ['view', 'update', 'delete']:
            return jsonify({"error": "Invalid administrative action directive."}), 400

        duplicate_check = PermissionRequest.query.filter_by(
            user_id=current_user_id,
            module_name=CUSTOMER_PROFILE_MODULE,
            permission_type=requested_tier,
            status='Pending'
        ).first()

        if duplicate_check:
            return jsonify({"message": "Access request already logged in workspace queues."}), 200

        new_request = PermissionRequest(
            user_id=current_user_id,
            module_name=CUSTOMER_PROFILE_MODULE,
            permission_type=requested_tier,
            status='Pending'
        )
        db.session.add(new_request)
        db.session.commit()

        return jsonify({"success": True, "message": "Access level elevation mapped successfully!"}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500