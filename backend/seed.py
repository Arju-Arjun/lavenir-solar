# from decimal import Decimal
# from werkzeug.security import generate_password_hash

# from app import app
# from models import (
#     db,
#     User,
#     CustomerProject,
#     UserPermission,
#     SiteVisit,
#     KsebRegistrationCompletion,
#     MNREInstallation,MNREProfile
#     ,Service,MaterialDelivery,MaterialDeliveryItem,KSEB,DCRCertificate,PermissionRequest,Payment,Notification,PushSubscription
# )

# # PASSWORD = "admin123"


# # def create_default_permissions():
# #     return {
# #         "dashboard": {
# #             "view": True,
# #             "create": False,
# #             "update": False,
# #             "delete": False,
# #         },
# #         "customers": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": True,
# #         },
# #         "site_visit": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": True,
# #         },
# #         "mnre": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": True,
# #         },
# #         "payments": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": True,
# #         },
# #         "kseb": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": False,
# #         },
# #         "bank_loan": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": False,
# #         },
# #         "staff": {
# #             "view": True,
# #             "create": True,
# #             "update": True,
# #             "delete": False,
# #         },
# #         "reports": {
# #             "view": True,
# #             "create": False,
# #             "update": False,
# #             "delete": False,
# #         },
# #     }


# # with app.app_context():
# #     print("=" * 60)
# #     print("Dropping all existing tables...")
# #     print("=" * 60)
# #     db.drop_all()

# #     print("=" * 60)
# #     print("Creating tables...")
# #     print("=" * 60)
# #     db.create_all()

# #     admin = User(
# #         full_name="Administrator",
# #         role="admin",
# #         email="admin@example.com",
# #         phone_number="9999999999",
# #         password=generate_password_hash(PASSWORD),
# #         admin_id="ADM001",
# #         department="Administration",
# #         status="Active",
# #     )
# #     db.session.add(admin)
# #     db.session.commit()

# #     db.session.add(
# #         UserPermission(
# #             user_id=admin.id,
# #             permissions_matrix=str(create_default_permissions()),
# #             updated_by=admin.id,
# #         )
# #     )

# #     staff_users = []
# #     for i in range(1, 4):
# #         staff = User(
# #             full_name=f"Staff {i}",
# #             role="staff",
# #             email=f"staff{i}@example.com",
# #             phone_number=f"900000000{i}",
# #             password=generate_password_hash(PASSWORD),
# #             employee_id=f"EMP00{i}",
# #             department="Operations",
# #             status="Active",
# #         )
# #         db.session.add(staff)
# #         staff_users.append(staff)

# #     db.session.commit()

# #     for staff in staff_users:
# #         db.session.add(
# #             UserPermission(
# #                 user_id=staff.id,
# #                 permissions_matrix=str(create_default_permissions()),
# #                 updated_by=admin.id,
# #             )
# #         )

# #     customers = [
# #         CustomerProject(
# #             customer_id="CUS001",
# #             customer_name="Rahul Kumar",
# #             email="rahul@gmail.com",
# #             phone_number="9876543210",
# #             district="Kollam",
# #             place="Chavara",
# #             capacity_kw=Decimal("3.00"),
# #             project_status="Active",
# #         ),
# #         CustomerProject(
# #             customer_id="CUS002",
# #             customer_name="Arun Nair",
# #             email="arun@gmail.com",
# #             phone_number="9876543211",
# #             district="Ernakulam",
# #             place="Kochi",
# #             capacity_kw=Decimal("5.00"),
# #             project_status="Active",
# #         ),
# #     ]

# #     db.session.add_all(customers)
# #     db.session.commit()

# #     print("=" * 60)
# #     print("Seed completed successfully")
# #     print("=" * 60)
# #     print("\nLogin Details")
# #     print("Admin: admin@example.com / admin123")
# #     print("Staff: staff1@example.com, staff2@example.com, staff3@example.com / admin123")

# from sqlalchemy import text

# # # # drop table sitevivsit
# # with app.app_context():
# #     db.session.execute(text("DROP TABLE material_deliveries CASCADE;"))
# #     db.session.execute(text("DROP TABLE material_delivery_items CASCADE;"))
# #     db.session.commit()
# #     #print all tables in the database
# #     # result = db.session.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))
# #     # tables = [row[0] for row in result]
# #     # print("Tables in the database:")
# #     # for table in tables:
# #     #     print(f" - {table}")
# #     # print first 2 rows in mnre installation and columns
# #     # result = db.session.execute(text("SELECT * FROM mnre_installations LIMIT 2"))
# #     # rows = result.fetchall()
# #     # print("First 2 rows in mnre_installations:")
# #     # for row in rows:
# #     #     print(row)
        
    



    

# # from models import db, Service, CustomerProject

# # customers = CustomerProject.query.all()
# # for customer in customers:
# #     services = (
# #         Service.query.filter_by(customer_project_id=customer.id)
# #         .order_by(Service.created_at.asc())
# #         .all()
# #     )
# #     for i, s in enumerate(services, start=1):
# #         s.service_number = i
# #     customer.last_service_number = len(services)

# # db.session.commit()




# #add column work_done = db.Column(db.String(30), default='Pending', nullable=False) to SiteVisit, KsebRegistrationCompletion, MNREInstallation, Service, MaterialDelivery, MaterialDeliveryItem

# # with app.app_context():
#     # db.session.execute(text("ALTER TABLE material_delivery_items ADD COLUMN work_done VARCHAR(30) DEFAULT 'Pending' NOT NULL;"))
#     # db.session.commit()
    
#     # # print columns name and its inside value of 2 rows(eg: fee_paid : yes yes    ownsership_status : yes no) 
#     # # usepermisiion
#     # result = db.session.execute(text("SELECT * FROM user_permissions LIMIT 2"))
#     # rows = result.fetchall()
#     # for row in rows:
#     #     for column, value in zip(result.keys(), row):
#     #         print(f"{column}: {value}")
#     #         print("\n")
#     # #     total_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
#     # # due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00) 

#     # # #add total_amount and due_amount columns to payments table
#     # # db.session.execute(text("ALTER TABLE payments ADD COLUMN total_amount NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;"))
#     # # db.session.execute(text("ALTER TABLE payments ADD COLUMN due_amount NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;"))
#     # # db.session.commit()


# from models import UserPermission
# import ast
# import re

#     # # Target staff user record query wrapper
#     # perm = UserPermission.query.filter_by(user_id=2).first()
#     # if perm:
#     #     # permissions_matrix may contain javascript-style booleans (true/false) or null
#     #     # normalize those tokens so ast.literal_eval can parse the string
#     #     raw = perm.permissions_matrix
#     #     normalized = re.sub(r"\btrue\b", "True", raw, flags=re.IGNORECASE)
#     #     normalized = re.sub(r"\bfalse\b", "False", normalized, flags=re.IGNORECASE)
#     #     normalized = re.sub(r"\bnull\b", "None", normalized, flags=re.IGNORECASE)
#     #     print(ast.literal_eval(normalized))
#     # else:
#     #     print("No matrix assigned to this operator yet.")

# #drop table  service

# def drop_notification_table():
#     with app.app_context():
#         db.session.execute(text("DROP TABLE notifications CASCADE;"))
#         db.session.commit()

# # drop_notification_table()


# # print user table columns  and values

# def print_user_table():
#     with app.app_context():
#         result = db.session.execute(text("SELECT * FROM users LIMIT 2"))
#         rows = result.fetchall()
#         for row in rows:
#             for column, value in zip(result.keys(), row):
#                 print(f"{column}: {value}")
#             print("\n")
# # print_user_table()

# # add column total_approved_loan_amount in bank_loan table
# def add_total_approved_loan_amount_column():
#     with app.app_context():
#         db.session.execute(text("ALTER TABLE bank_loans ADD COLUMN total_approved_loan_amount NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;"))
#         db.session.commit()
# # add_total_approved_loan_amount_column()


# # due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)   add column in bank_loan table
# def add_due_amount_column():
#     with app.app_context():
#         db.session.execute(text("ALTER TABLE bank_loans ADD COLUMN due_amount NUMERIC(12, 2) DEFAULT 0.00 NOT NULL;"))
#         db.session.commit()
# # add_due_amount_column()



#     # __tablename__ = 'customer_projects'
    
#     # id = db.Column(db.Integer, primary_key=True)
#     # sl_no = db.Column(db.Integer, autoincrement=True, unique=True, nullable=True)
#     # customer_id = db.Column(db.String(50), unique=True, nullable=False)
#     # customer_name = db.Column(db.String(100), nullable=False)
#     # profile_photo = db.Column(db.String(255), nullable=True, default="https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg")
#     # email = db.Column(db.String(120), nullable=True)
#     # phone_number = db.Column(db.String(20), nullable=False)
#     # district = db.Column(db.String(50), nullable=False)
#     # place = db.Column(db.String(100), nullable=False)
#     # capacity_kw = db.Column(db.Numeric(10, 2), nullable=False, default=0.00)
#     # project_status = db.Column(db.String(20), default='Active')
    
#     # created_date = db.Column(db.DateTime, default=datetime.utcnow)
#     # last_updated = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
#     # last_service_number = db.Column(db.Integer, default=0, nullable=False)


# # crete  2 function and add customer and remove same customer from the database and  create date  aug,spetmber,oct,dec 2026(20) and 2027 jan ,feb,march create15 customers and add them to the database with random data and print all customers in the database
# # must one is creeated date

# def seed_customers():
#     from datetime import datetime, timedelta
#     import random

#     with app.app_context():
#         # Clear existing customers
#         # db.session.query(CustomerProject).delete()

#         # Generate random customers
#         for i in range(1, 16):
#             created_date = datetime(2026, random.randint(8, 12), random.randint(1, 28)) if i <= 10 else datetime(2027, random.randint(1, 3), random.randint(1, 28))
#             customer = CustomerProject(
#                 customer_id=i,
#                 customer_name=f"Customer {i}",
#                 email=f"customer{i}@example.com",
#                 phone_number=f"987654321{i}",
#                 district=f"District {i}",
#                 place=f"Place {i}",
#                 capacity_kw=3,
#                 project_status="Active",
#                 created_date=created_date
#             )
#             db.session.add(customer)

#         db.session.commit()

# def remove_customer(customer_id):
#     with app.app_context():
#         customer = CustomerProject.query.filter_by(customer_id=customer_id).first()
#         if customer:
#             db.session.delete(customer)
#             db.session.commit()
#             print(f"Customer with ID {customer_id} removed.")
#         else:
#             print(f"No customer found with ID {customer_id}.")

# # for i in range(1, 16):
#     # remove_customer(i)

# # seed_customers()



# # proof_file = db.Column(db.String(255))

# # ഇത് ഇങ്ങനെ മാറ്റുക:

# # python
# # proof_file = db.Column(db.Text)

# def update_proof_file_column():
#     with app.app_context():
#         db.session.execute(text("ALTER TABLE payments ALTER COLUMN proof_file TYPE TEXT;"))
#         db.session.commit()
# update_proof_file_column()



from decimal import Decimal
from sqlalchemy import text
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

# PASSWORD = "admin123"

# def create_default_permissions():
#     return {
#         "dashboard": {
#             "view": True,
#             "create": False,
#             "update": False,
#             "delete": False,
#         },
#         "customers": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": True,
#         },
#         "site_visit": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": True,
#         },
#         "mnre": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": True,
#         },
#         "payments": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": True,
#         },
#         "kseb": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": False,
#         },
#         "bank_loan": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": False,
#         },
#         "staff": {
#             "view": True,
#             "create": True,
#             "update": True,
#             "delete": False,
#         },
#         "reports": {
#             "view": True,
#             "create": False,
#             "update": False,
#             "delete": False,
#         },
#     }

# with app.app_context():
#     print("=" * 60)
#     print("Dropping all existing tables...")
#     print("=" * 60)
#     db.drop_all()

#     print("=" * 60)
#     print("Creating fresh tables...")
#     print("=" * 60)
#     db.create_all()

#     print("Creating Administrator account...")
#     admin = User(
#         full_name="Administrator",
#         role="admin",
#         email="admin@example.com",
#         phone_number="9999999999",
#         password=generate_password_hash(PASSWORD),
#         admin_id="ADM001",
#         department="Administration",
#         status="Active",
#     )
#     db.session.add(admin)
#     db.session.commit()

#     db.session.add(
#         UserPermission(
#             user_id=admin.id,
#             permissions_matrix=str(create_default_permissions()),
#             updated_by=admin.id,
#         )
#     )

#     print("Creating Staff accounts...")
#     staff_users = []
#     for i in range(1, 4):
#         staff = User(
#             full_name=f"Staff {i}",
#             role="staff",
#             email=f"staff{i}@example.com",
#             phone_number=f"900000000{i}",
#             password=generate_password_hash(PASSWORD),
#             employee_id=f"EMP00{i}",
#             department="Operations",
#             status="Active",
#         )
#         db.session.add(staff)
#         staff_users.append(staff)

#     db.session.commit()

#     for staff in staff_users:
#         db.session.add(
#             UserPermission(
#                 user_id=staff.id,
#                 permissions_matrix=str(create_default_permissions()),
#                 updated_by=admin.id,
#             )
#         )

#     print("Creating initial customer profiles...")
#     customers = [
#         CustomerProject(
#             customer_id="CUS001",
#             customer_name="Rahul Kumar",
#             email="rahul@gmail.com",
#             phone_number="9876543210",
#             district="Kollam",
#             place="Chavara",
#             capacity_kw=Decimal("3.00"),
#             project_status="Active",
#         ),
#         CustomerProject(
#             customer_id="CUS002",
#             customer_name="Arun Nair",
#             email="arun@gmail.com",
#             phone_number="9876543211",
#             district="Ernakulam",
#             place="Kochi",
#             capacity_kw=Decimal("5.00"),
#             project_status="Active",
#         ),
#     ]

#     db.session.add_all(customers)
#     db.session.commit()

#     print("=" * 60)
#     print("Database seeding completed successfully! 🎉")
#     print("=" * 60)
#     print("\nLogin Credentials:")
#     print("Admin : admin@example.com / admin123")
#     print("Staff 1: staff1@example.com / admin123")
#     print("Staff 2: staff2@example.com / admin123")
#     print("Staff 3: staff3@example.com / admin123")

def add_column_profile_photo_to_users():
    with app.app_context():
        # IF NOT EXISTS makes this safe to run more than once.
        db.session.execute(text(
            "ALTER TABLE users "
            "ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(255) "
            "DEFAULT 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg';"
        ))
        db.session.commit()  # <-- this was missing, so the ALTER never persisted
        print("profile_photo column ensured on users table.")

if __name__ == "__main__":
    add_column_profile_photo_to_users()