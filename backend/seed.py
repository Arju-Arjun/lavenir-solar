from decimal import Decimal
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
    PushSubscription
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


# def add_customer_sl_no_sequence():
#     """
#     Creates customer_sl_no_seq and primes it past whatever sl_no values
#     already exist in customer_projects.

#     Fixes the "Could not allocate a unique customer ID; please retry." (409)
#     error in create_customer() — that code used SELECT MAX(sl_no) + 1 to pick
#     the next customer_id, which races when two create-customer requests land
#     close together. get_next_sl_no() in customers.py now calls
#     nextval('customer_sl_no_seq') instead, which is atomic at the DB level.

#     Safe to run more than once — skips creation if the sequence already
#     exists, but re-runs setval() either way so it's always caught up with
#     the current max sl_no (harmless, setval is idempotent here).
#     """
#     with app.app_context():
#         existing = db.session.execute(text(
#             "SELECT sequence_name FROM information_schema.sequences "
#             "WHERE sequence_name = 'customer_sl_no_seq'"
#         )).fetchone()

#         if not existing:
#             db.session.execute(text("CREATE SEQUENCE customer_sl_no_seq;"))
#             print("customer_sl_no_seq sequence created.")
#         else:
#             print("customer_sl_no_seq already exists — skipping creation.")

#         # Sequences default to MINVALUE 1, so setval(seq, 0) raises
#         # "value 0 is out of bounds" when the table is empty (MAX(sl_no)
#         # is NULL). The fix: when there are no rows yet, set the sequence
#         # to 1 with is_called=false, meaning "not consumed yet" — the next
#         # nextval() call still returns 1. When rows exist, set is_called=true
#         # so the next nextval() correctly returns MAX(sl_no) + 1.
#         max_sl_no = db.session.execute(text(
#             "SELECT MAX(sl_no) FROM customer_projects"
#         )).scalar()

#         if max_sl_no is None:
#             db.session.execute(text(
#                 "SELECT setval('customer_sl_no_seq', 1, false);"
#             ))
#         else:
#             db.session.execute(text(
#                 "SELECT setval('customer_sl_no_seq', :max_sl_no, true);"
#             ), {"max_sl_no": max_sl_no})

#         db.session.commit()
#         print("customer_sl_no_seq synced to current MAX(sl_no).")


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
# drop all tables and data include cludinary files
def drop_all_tables_and_data():
    with app.app_context():
        # Drop all tables in the database
        db.drop_all()
        db.session.commit()
        print("All tables dropped successfully.")

        # Optionally, you can also clear Cloudinary files if needed.
        # This requires Cloudinary API credentials and proper setup.
        # Uncomment the following lines if you want to clear Cloudinary files.
        # import cloudinary
        # import cloudinary.api
        # cloudinary.api.delete_resources_by_prefix('your_folder_prefix')
        # print("Cloudinary files cleared successfully.")




if __name__ == '__main__':
    # run()
    # print_kseb_data()
    # pass
    ensure_modules_completed_at_column()