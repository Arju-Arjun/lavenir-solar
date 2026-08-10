import os
from decimal import Decimal
from tkinter import FALSE
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash

from app import app
from models import (
    db,
    User,
    CustomerProject,
    UserPermission,
    SiteVisit,
    KsebRegistrationCompletion,
    MNREInstallation,
    MNREProfile,
    Service,
    MaterialDelivery,
    MaterialDeliveryItem,
    KSEB,
    DCRCertificate,
    PermissionRequest,
    Payment,
    Notification,
    PushSubscription,
    Complaint,
    ComplaintAttachment,
    ComplaintComment,

    
)

# # ... (existing commented-out seed / column functions unchanged) ...


# def add_column_profile_photo_to_users():
#     with app.app_context():
#         # IF NOT EXISTS makes this safe to run more than once.
#         db.session.execute(text(
#             "ALTER TABLE users "
#             "ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(255) "
#             "DEFAULT 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg';"
#         ))
#         db.session.commit()  # <-- this was missing, so the ALTER never persisted
#         print("profile_photo column ensured on users table.")


# def category():
#     with app.app_context():
#         existing = db.session.execute(text(
#             "SELECT column_name FROM information_schema.columns "
#             "WHERE table_name = 'kseb' AND column_name = 'comments'"
#         )).fetchone()

#         if existing:
#             print("comments column already exists on  — skipping.")
#             return

#         db.session.execute(text(
#             "ALTER TABLE kseb "
#             "ADD COLUMN comments TEXT"
#         ))
#         db.session.commit()
#         print("comments column added to kseb successfully.")


# def add_column_feasibility_notified_date_customerprojects():
#     with app.app_context():
#         existing = db.session.execute(text(
#             "SELECT column_name FROM information_schema.columns "
#             "WHERE table_name = 'customer_projects' AND column_name = 'feasibility_notified_date'"
#         )).fetchone()

#         if existing:
#             print("feasibility_notified_date column already exists on customer_projects — skipping.")
#             return

#         db.session.execute(text(
#             "ALTER TABLE customer_projects "
#             "ADD COLUMN feasibility_notified_date DATE"
#         ))
#         db.session.commit()
#         print("feasibility_notified_date column added to customer_projects successfully.")


def add_customer_sl_no_sequence():
    """
    Creates customer_sl_no_seq and primes it past whatever sl_no values
    already exist in customer_projects.

    Fixes the "Could not allocate a unique customer ID; please retry." (409)
    error in create_customer() — that code used SELECT MAX(sl_no) + 1 to pick
    the next customer_id, which races when two create-customer requests land
    close together. get_next_sl_no() in customers.py now calls
    nextval('customer_sl_no_seq') instead, which is atomic at the DB level.

    Safe to run more than once — skips creation if the sequence already
    exists, but re-runs setval() either way so it's always caught up with
    the current max sl_no (harmless, setval is idempotent here).
    """
    with app.app_context():
        existing = db.session.execute(text(
            "SELECT sequence_name FROM information_schema.sequences "
            "WHERE sequence_name = 'customer_sl_no_seq'"
        )).fetchone()

        if not existing:
            db.session.execute(text("CREATE SEQUENCE customer_sl_no_seq;"))
            print("customer_sl_no_seq sequence created.")
        else:
            print("customer_sl_no_seq already exists — skipping creation.")

        # Sequences default to MINVALUE 1, so setval(seq, 0) raises
        # "value 0 is out of bounds" when the table is empty (MAX(sl_no)
        # is NULL). The fix: when there are no rows yet, set the sequence
        # to 1 with is_called=false, meaning "not consumed yet" — the next
        # nextval() call still returns 1. When rows exist, set is_called=true
        # so the next nextval() correctly returns MAX(sl_no) + 1.
        max_sl_no = db.session.execute(text(
            "SELECT MAX(sl_no) FROM customer_projects"
        )).scalar()

        if max_sl_no is None:
            db.session.execute(text(
                "SELECT setval('customer_sl_no_seq', 1, false);"
            ))
        else:
            db.session.execute(text(
                "SELECT setval('customer_sl_no_seq', :max_sl_no, true);"
            ), {"max_sl_no": max_sl_no})

        db.session.commit()
        print("customer_sl_no_seq synced to current MAX(sl_no).")


# def reset_and_seed_users():
#     """
#     ⚠️ DESTRUCTIVE — drops every table in the database, recreates the full
#     schema from the current models.py, then seeds initial users.
#     """
#     with app.app_context():
#         # Force-drop the old orphaned table that is blocking customer_projects
#         db.session.execute(text("DROP TABLE IF EXISTS notification_logs CASCADE;"))
#         db.session.commit()

#         # Now SQLAlchemy can safely drop the rest of the known tables
#         db.drop_all()
#         db.create_all()
#         print("All tables dropped and schema recreated from models.py.")

#         admin = User(
#             full_name="Admin",
#             role="admin",
#             email="admin@example.com",
#             password=generate_password_hash("admin123"),
#         )
#         db.session.add(admin)

#         staff_accounts = [
#             {"full_name": "Staff One", "email": "staff1@example.com"},
#             {"full_name": "Staff Two", "email": "staff2@example.com"},
#         ]
#         for s in staff_accounts:
#             staff = User(
#                 full_name=s["full_name"],
#                 role="staff",
#                 email=s["email"],
#                 password=generate_password_hash("staff123"),
#             )
#             db.session.add(staff)

#         db.session.commit()
#         print("Seeded: 1 admin (admin@example.com) + 2 staff (staff1@example.com, staff2@example.com).")



# # CREATE INDEX ix_notifications_customer_notiftype_created 
# #   ON notifications (customer_project_id, notif_type, created_at);

# def create_notifications_index():
#     with app.app_context():
#         db.session.execute(text(
#             "CREATE INDEX IF NOT EXISTS ix_notifications_customer_notiftype_created "
#             "ON notifications (customer_project_id, notif_type, created_at);"
#         ))
#         db.session.commit()
#         print("Index ix_notifications_customer_notiftype_created ensured on notifications table.")



# # ALTER TABLE notifications
# # DROP CONSTRAINT notifications_customer_project_id_fkey,
# # ADD CONSTRAINT notifications_customer_project_id_fkey
# # FOREIGN KEY (customer_project_id) REFERENCES customer_projects(id) ON DELETE CASCADE;

# def add_cascade_delete_to_notifications():
#     with app.app_context():
#         # Drop the existing foreign key constraint
#         db.session.execute(text(
#             "ALTER TABLE notifications "
#             "DROP CONSTRAINT IF EXISTS notifications_customer_project_id_fkey;"
#         ))

#         # Add the new foreign key constraint with ON DELETE CASCADE
#         db.session.execute(text(
#             "ALTER TABLE notifications "
#             "ADD CONSTRAINT notifications_customer_project_id_fkey "
#             "FOREIGN KEY (customer_project_id) REFERENCES customer_projects(id) ON DELETE CASCADE;"
#         ))

#         db.session.commit()
#         print("Foreign key constraint on notifications.customer_project_id updated to ON DELETE CASCADE.")


def ensure_modules_completed_at_column():
    """Ensure the `modules_completed_at` column exists on `customer_projects`.

    Safe to run multiple times; checks information_schema before altering.
    """
    with app.app_context():
        existing = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'customer_projects' AND column_name = 'modules_completed_at'"
        )).fetchone()

        if existing:
            print("modules_completed_at column already exists on customer_projects — skipping.")
            return

        db.session.execute(text(
            "ALTER TABLE customer_projects "
            "ADD COLUMN modules_completed_at TIMESTAMP"
        ))
        db.session.commit()
        print("modules_completed_at column added to customer_projects successfully.")

# def print_modules_for_customer(customer_id):
#     with app.app_context():
#         # Query the customer project
#         customer_project = CustomerProject.query.filter_by(customer_id=customer_id).first()
#         if not customer_project:
#             print(f"No customer project found for customer {customer_id}.")
#             return

#         # Dictionary of direct child models containing 'customer_project_id'
#         direct_modules = {
#             "Site Visits": SiteVisit,
#             "KSEB Registrations": KsebRegistrationCompletion,
#             "MNRE Installations": MNREInstallation,
#             "MNRE Profiles": MNREProfile,
#             "Services": Service,
#             "Material Deliveries": MaterialDelivery,
#             "KSEB Records": KSEB,
#             "DCR Certificates": DCRCertificate,
#             "Payments": Payment,
#             "Notifications": Notification
#         }

#         print(f"Modules for customer {customer_id} (project id {customer_project.id}):")
        
#         # 1. Count standard direct relationships
#         for module_name, model in direct_modules.items():
#             count = db.session.query(model).filter_by(customer_project_id=customer_project.id).count()
#             print(f"{module_name}: {count} records")
            
#         # 2. Count indirect relationships (Material Delivery Items) using a JOIN
#         mdi_count = (
#             db.session.query(MaterialDeliveryItem)
#             .join(MaterialDelivery)
#             .filter(MaterialDelivery.customer_project_id == customer_project.id)
#             .count()
#         )
#         print(f"Material Delivery Items: {mdi_count} records")

# if __name__ == "__main__":
#     # add_column_profile_photo_to_users()
#     # category()
#     # add_column_feasibility_notified_date_customerprojects()
#     # add_customer_sl_no_sequence()
#     # reset_and_seed_users()
#     # create_notifications_index()
#     # add_cascade_delete_to_notifications()
#     print_modules_for_customer("CUS010")


"""
One-off migration: drop the old `complaints` table and create the new
complaints schema (complaints, complaint_attachments, complaint_comments).

This is a FRESH START migration - existing complaint rows/attachments are
NOT preserved. Run this once, after deploying the new models.py.

Usage:
    python migrate_complaints.py

Make sure your app's DB config (SQLALCHEMY_DATABASE_URI) is reachable from
wherever you run this - it imports your Flask app the same way app.py does.
Adjust the import below if your app factory/instance is named differently.
"""

from sqlalchemy import text

# Adjust this import to match how your app builds `app` and imports `db`.
from app import app          # noqa: E402  (your Flask app instance)
from models import db        # noqa: E402


def run():
    with app.app_context():
        # Drop old table(s). CASCADE also removes any FKs pointing at it
        # (e.g. if anything else referenced complaints.id).
        db.session.execute(text("DROP TABLE IF EXISTS complaints CASCADE;"))
        db.session.commit()
        print("Dropped old 'complaints' table (if it existed).")

        # Recreate schema for Complaint, ComplaintAttachment, ComplaintComment
        # (and any other model not yet created) from the current models.py.
        db.create_all()
        print("Created new complaints / complaint_attachments / complaint_comments tables.")
# print KSEB all data all customer projects
def print_kseb_data():
    with app.app_context():
        rows = db.session.execute(text("SELECT * FROM kseb;")).fetchall()
        if not rows:
            print("No KSEB records found.")
            return
        for row in rows:
            # SQLAlchemy Row may not be directly convertible to dict via dict(row)
            # Use the row._mapping (PEP 249 mapping) when available for a stable dict
            try:
                data = dict(row._mapping)
            except Exception:
                try:
                    data = dict(row)
                except Exception:
                    # Fallback: build dict from keys() and positional values
                    try:
                        keys = list(row.keys())
                        data = {k: row[i] for i, k in enumerate(keys)}
                    except Exception:
                        # As a last resort, print the raw row
                        print(row)
                        continue
            print(data)
def drop_all_tables_and_data():
    with app.app_context():
        db.drop_all()
        db.session.commit()
        db.create_all()
        db.session.commit()
        print("All tables dropped successfully and the schema was recreated.")


def delete_all_cloudinary_files():
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")

    if not all([cloud_name, api_key, api_secret]):
        print("Cloudinary credentials not configured. Skipping Cloudinary cleanup.")
        return

    try:
        import cloudinary
        import cloudinary.api
    except ImportError:
        print("cloudinary package is not installed. Skipping Cloudinary cleanup.")
        return

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
    )

    try:
        result = cloudinary.api.delete_resources_by_prefix('seed-cleanup')
        print("Cloudinary cleanup completed successfully.")
        print(result)
    except Exception as e:
        print(f"Cloudinary cleanup skipped: {e}")




# create admin user
def create_admin_user():
    with app.app_context():
        # Ensure the schema exists before querying or inserting users.
        db.create_all()
        db.session.commit()

        # Check if an admin user already exists
        existing_admin = User.query.filter_by(role='admin').first()
        if existing_admin:
            print("Admin user already exists. Skipping creation.")
            return

        # Create a new admin user
        admin_user = User(
            full_name="vysakhmurali",
            role="admin",
            email="vysakhmurali768@gmail.com",
            password=generate_password_hash("admin123"),
        )
        db.session.add(admin_user)
        db.session.commit()
        print("Admin user created successfully.")

def add_visited_date_column_to_site_visit():
    with app.app_context():
        table_name = getattr(SiteVisit, '__tablename__', 'site_visit')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping visited_date column addition.")
            return

        existing = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'visited_date'"
        ), {"table_name": table_name}).fetchone()

        if existing:
            print(f"visited_date column already exists on {table_name} — skipping.")
            return

        db.session.execute(text(
            f"ALTER TABLE {table_name} "
            "ADD COLUMN visited_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ))
        db.session.commit()
        print(f"visited_date column added to {table_name} successfully.")

def add_payment_date_and_visiter_name_columns_to_kseb():
    with app.app_context():
        table_name = getattr(KSEB, '__tablename__', 'kseb')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping column additions.")
            return

        # Add payment_date column
        existing_payment_date = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'payment_date'"
        ), {"table_name": table_name}).fetchone()

        if existing_payment_date:
            print(f"payment_date column already exists on {table_name} — skipping.")
        else:
            db.session.execute(text(
                f"ALTER TABLE {table_name} "
                "ADD COLUMN payment_date TIMESTAMP"
            ))
            print(f"payment_date column added to {table_name} successfully.")

        # Add visiter_name column
        existing_visiter_name = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'visiter_name'"
        ), {"table_name": table_name}).fetchone()

        if existing_visiter_name:
            print(f"visiter_name column already exists on {table_name} — skipping.")
        else:
            db.session.execute(text(
                f"ALTER TABLE {table_name} "
                "ADD COLUMN visiter_name VARCHAR(100)"
            ))
            print(f"visiter_name column added to {table_name} successfully.")

        db.session.commit()
    # delivery_document = db.Column(db.String(255), nullable=True) is change  db.Column(db.Text, nullable=True)
def alter_delivery_document_column_type():
    with app.app_context():
        table_name = getattr(MaterialDelivery, '__tablename__', 'material_delivery')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping column type alteration.")
            return

        # Check the current data type of the delivery_document column
        current_type = db.session.execute(text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'delivery_document'"
        ), {"table_name": table_name}).scalar()

        if current_type == 'text':
            print(f"delivery_document column is already of type TEXT on {table_name} — skipping.")
            return

        # Alter the column type to TEXT
        db.session.execute(text(
            f"ALTER TABLE {table_name} "
            "ALTER COLUMN delivery_document TYPE TEXT"
        ))
        db.session.commit()
        print(f"delivery_document column type altered to TEXT on {table_name} successfully.")



# ALTER TABLE notifications ADD COLUMN popup_seen BOOLEAN NOT NULL DEFAULT FALSE;
# ALTER TABLE notifications ADD COLUMN popup_resolved BOOLEAN NOT NULL DEFAULT FALSE;

def add_popup_columns_to_notifications():
    with app.app_context():
        table_name = getattr(Notification, '__tablename__', 'notifications')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping popup column additions.")
            return

        # Add popup_seen column
        existing_popup_seen = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'popup_seen'"
        ), {"table_name": table_name}).fetchone()

        if existing_popup_seen:
            print(f"popup_seen column already exists on {table_name} — skipping.")
        else:
            db.session.execute(text(
                f"ALTER TABLE {table_name} "
                "ADD COLUMN popup_seen BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            print(f"popup_seen column added to {table_name} successfully.")

        # Add popup_resolved column
        existing_popup_resolved = db.session.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'popup_resolved'"
        ), {"table_name": table_name}).fetchone()

        if existing_popup_resolved:
            print(f"popup_resolved column already exists on {table_name} — skipping.")
        else:
            db.session.execute(text(
                f"ALTER TABLE {table_name} "
                "ADD COLUMN popup_resolved BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            print(f"popup_resolved column added to {table_name} successfully.")

        db.session.commit()





"""-- Run this ONCE, before deploying the model change (unique=True on
-- customer_project_id), so the ALTER TABLE at the end doesn't fail on
-- pre-existing duplicates.

-- 1. See how bad it is first.
SELECT customer_project_id, COUNT(*) AS row_count
FROM site_visits
GROUP BY customer_project_id
HAVING COUNT(*) > 1;

-- 2. For each duplicate group, keep the row with the most recently
--    updated_at (fall back to highest id if updated_at ties), delete the
--    rest. This assumes the "most recently touched" row holds the data you
--    actually want to keep — eyeball the SELECT above first, especially if
--    a legacy duplicate has documents/photos uploaded on it that the
--    "winning" row doesn't.
DELETE FROM site_visits sv
WHERE sv.id NOT IN (
    SELECT DISTINCT ON (customer_project_id) id
    FROM site_visits
    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
);

-- 3. Now safe to add the constraint (SQLAlchemy's create_all() won't alter
--    an existing table, so this has to be applied by hand or via your
--    migration tool, e.g. Alembic/Flask-Migrate).
ALTER TABLE site_visits
    ADD CONSTRAINT uq_site_visits_customer_project_id UNIQUE (customer_project_id);"""

def ensure_unique_site_visits():
    with app.app_context():
        # Step 1: Identify duplicates
        duplicates = db.session.execute(text(
            "SELECT customer_project_id, COUNT(*) AS row_count "
            "FROM site_visits "
            "GROUP BY customer_project_id "
            "HAVING COUNT(*) > 1;"
        )).fetchall()

        if not duplicates:
            print("No duplicate site_visits found. Safe to add unique constraint.")
            return

        print(f"Found {len(duplicates)} duplicate customer_project_id(s) in site_visits. Cleaning up...")

        # Step 2: Delete duplicates, keeping the most recently updated row
        db.session.execute(text(
            "DELETE FROM site_visits sv "
            "WHERE sv.id NOT IN ("
            "    SELECT DISTINCT ON (customer_project_id) id "
            "    FROM site_visits "
            "    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC"
            ");"
        ))
        db.session.commit()
        print("Duplicate site_visits cleaned up. You can now safely add the unique constraint.")


"""-- Run this ONCE, before deploying the model change (unique=True on
-- customer_project_id), so the ALTER TABLE statements at the end don't fail
-- on pre-existing duplicates. Covers every table that's meant to hold ONE
-- row per customer (uselist=False relationship in models.py):
--   site_visits, mnre_profiles, material_deliveries, material_installations
-- (bank_loans, payments, mnre_installations, kseb_registration_completion,
-- dcr_certificates already had unique=True, so they're not included here.)



-- 2. For each duplicate group, keep the row with the most recent
--    updated_at (fall back to highest id if updated_at ties), delete the
--    rest. This assumes the "most recently touched" row holds the data you
--    actually want to keep — eyeball step 1's output first, especially if
--    a legacy duplicate has documents/photos/images uploaded on it that the
--    "winning" row doesn't (site_visits, mnre_profiles, and both material_*
--    tables all carry file/image columns that would be silently dropped).

DELETE FROM site_visits sv
WHERE sv.id NOT IN (
    SELECT DISTINCT ON (customer_project_id) id
    FROM site_visits
    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
);

DELETE FROM mnre_profiles t
WHERE t.id NOT IN (
    SELECT DISTINCT ON (customer_project_id) id
    FROM mnre_profiles
    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
);

-- material_deliveries has a child table (material_delivery_items) FK'd to
-- it with no cascade declared in models.py — delete the orphaned children
-- first or this will fail with a FK violation.
DELETE FROM material_delivery_items
WHERE material_delivery_id IN (
    SELECT id FROM material_deliveries
    WHERE id NOT IN (
        SELECT DISTINCT ON (customer_project_id) id
        FROM material_deliveries
        ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
    )
);

DELETE FROM material_deliveries t
WHERE t.id NOT IN (
    SELECT DISTINCT ON (customer_project_id) id
    FROM material_deliveries
    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
);

DELETE FROM material_installations t
WHERE t.id NOT IN (
    SELECT DISTINCT ON (customer_project_id) id
    FROM material_installations
    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC
);

-- 3. Now safe to add the constraints (SQLAlchemy's create_all() won't alter
--    an existing table, so these have to be applied by hand or via your
--    migration tool, e.g. Alembic/Flask-Migrate).
ALTER TABLE site_visits
    ADD CONSTRAINT uq_site_visits_customer_project_id UNIQUE (customer_project_id);

ALTER TABLE mnre_profiles
    ADD CONSTRAINT uq_mnre_profiles_customer_project_id UNIQUE (customer_project_id);

ALTER TABLE material_deliveries
    ADD CONSTRAINT uq_material_deliveries_customer_project_id UNIQUE (customer_project_id);

ALTER TABLE material_installations
    ADD CONSTRAINT uq_material_installations_customer_project_id UNIQUE (customer_project_id);

-- delivery_document was VARCHAR(255) but material.py stores a JSON-encoded
-- LIST of document URLs in it (like delivery_images, which was already
-- Text). 2+ uploaded documents overflow 255 chars -> Postgres rejects the
-- write ("value too long for type character varying(255)"), so saving
-- multiple delivery documents was failing outright. Widen it before
-- deploying the model change.
ALTER TABLE material_deliveries
    ALTER COLUMN delivery_document TYPE TEXT;"""

def ensure_unique_customer_modules():
    with app.app_context():
        # Step 1: Identify duplicates for each relevant table
        tables_to_check = [
            'site_visits',
            'mnre_profiles',
            'material_deliveries',
            'material_installations'
        ]

        for table in tables_to_check:
            duplicates = db.session.execute(text(
                f"SELECT customer_project_id, COUNT(*) AS row_count "
                f"FROM {table} "
                f"GROUP BY customer_project_id "
                f"HAVING COUNT(*) > 1;"
            )).fetchall()

            if not duplicates:
                print(f"No duplicate entries found in {table}. Safe to add unique constraint.")
                continue

            print(f"Found {len(duplicates)} duplicate customer_project_id(s) in {table}. Cleaning up...")

            # Step 2: Delete duplicates, keeping the most recently updated row
            db.session.execute(text(
                f"DELETE FROM {table} t "
                f"WHERE t.id NOT IN ("
                f"    SELECT DISTINCT ON (customer_project_id) id "
                f"    FROM {table} "
                f"    ORDER BY customer_project_id, updated_at DESC NULLS LAST, id DESC"
                f");"
            ))
            db.session.commit()
            print(f"Duplicate entries cleaned up in {table}. You can now safely add the unique constraint.")

"""-- Fix for: MaterialDelivery.delivery_date showing a date you never entered.
-- Root cause: the column was NOT NULL, so the auto-created "stub" delivery
-- row (created when material items are saved before the Delivery Date field
-- is touched) had to be filled with today's date as a placeholder.

-- 1. Allow delivery_date to be empty going forward.
ALTER TABLE material_deliveries
    ALTER COLUMN delivery_date DROP NOT NULL;

-- 2. Optional: clear the fabricated date on EXISTING stub rows — rows where
--    nothing else on the delivery was ever actually filled in by a user.
--    Check this matches your data before running (SELECT first if unsure).
UPDATE material_deliveries
SET delivery_date = NULL
WHERE electrical_delivered = false
  AND structure_delivered = false
  AND panel_delivered = false
  AND delivered_by IS NULL
  AND received_by IS NULL;
"""

def ensure_delivery_date_nullable():
    with app.app_context():
        table_name = getattr(MaterialDelivery, '__tablename__', 'material_deliveries')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping delivery_date column alteration.")
            return

        # Step 1: Alter the delivery_date column to allow NULL values
        db.session.execute(text(
            f"ALTER TABLE {table_name} "
            "ALTER COLUMN delivery_date DROP NOT NULL;"
        ))
        db.session.commit()
        print(f"delivery_date column altered to allow NULL values in {table_name}.")

        # Step 2: Optional - Clear fabricated dates on existing stub rows
        db.session.execute(text(
            f"UPDATE {table_name} "
            "SET delivery_date = NULL "
            "WHERE electrical_delivered = false "
            "AND structure_delivered = false "
            "AND panel_delivered = false "
            "AND delivered_by IS NULL "
            "AND received_by IS NULL;"
        ))
        db.session.commit()
        print(f"Fabricated delivery_date values cleared on stub rows in {table_name}.")






# drop (complaints,complaints_attachments,complaints_comments)
def drop_complaint_tables():
    with app.app_context():
        db.session.execute(text("DROP TABLE IF EXISTS complaint_comments CASCADE;"))
        db.session.execute(text("DROP TABLE IF EXISTS complaint_attachments CASCADE;"))
        db.session.execute(text("DROP TABLE IF EXISTS complaints CASCADE;"))
        db.session.commit()
        print("Dropped old 'complaints', 'complaint_attachments', and 'complaint_comments' tables (if they existed).")

# notif_type = db.Column(db.String(30), nullable=False, default='general') update to notif_type = db.Column(db.String(250), nullable=False, default='general')
def update_notif_type_column():
    with app.app_context():
        table_name = getattr(Notification, '__tablename__', 'notifications')
        inspector = inspect(db.engine)

        if not inspector.has_table(table_name):
            print(f"{table_name} table does not exist. Skipping notif_type column alteration.")
            return

        # Check the current data type of the notif_type column
        current_type = db.session.execute(text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'notif_type'"
        ), {"table_name": table_name}).scalar()

        if current_type == 'character varying' and db.session.execute(text(
            "SELECT character_maximum_length FROM information_schema.columns "
            "WHERE table_name = :table_name AND column_name = 'notif_type'"
        ), {"table_name": table_name}).scalar() == 250:
            print(f"notif_type column is already of type VARCHAR(250) on {table_name} — skipping.")
            return

        # Alter the column type to VARCHAR(250)
        db.session.execute(text(
            f"ALTER TABLE {table_name} "
            "ALTER COLUMN notif_type TYPE VARCHAR(250)"
        ))
        db.session.commit()
        print(f"notif_type column type altered to VARCHAR(250) on {table_name} successfully.")




if __name__ == '__main__':
    # run()
    # print_kseb_data()
    # pass
    # ensure_modules_completed_at_column()
    # delete_all_cloudinary_files()  # Call the function to delete all Cloudinary files
    # drop_all_tables_and_data()  # Call the function to drop all tables and data
    # create_admin_user()
    # add_customer_sl_no_sequence() 
    # add_visited_date_column_to_site_visit()  # Call the function to add visited_date column to site_visit
    # add_payment_date_and_visiter_name_columns_to_kseb()  # Call the function to add payment_date and visiter_name columns to kseb
    # alter_delivery_document_column_type()  # Call the function to alter the delivery_document column type
    # add_popup_columns_to_notifications()
    # ensure_unique_site_visits()
    # ensure_unique_customer_modules()
    # ensure_delivery_date_nullable()  # Call the function to ensure delivery_date is nullable
    update_notif_type_column()  # Call the function to update the notif_type column
    # drop_complaint_tables()  # Call the function to drop the complaint tables
