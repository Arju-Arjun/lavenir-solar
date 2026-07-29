from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # admin, staff
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone_number = db.Column(db.String(20), nullable=True)
    password = db.Column(db.String(255), nullable=False)
    profile_photo = db.Column(db.String(255), nullable=True, default="https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg")
    admin_id = db.Column(db.String(50), unique=True, nullable=True)
    employee_id = db.Column(db.String(50), unique=True, nullable=True)
    department = db.Column(db.String(50), nullable=True)
    status = db.Column(db.String(20), default='Active')
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "full_name": self.full_name,
            "role": self.role,
            "email": self.email,
            "phone_number": self.phone_number,
            "admin_id": self.admin_id,
            "employee_id": self.employee_id,
            "department": self.department,
            "status": self.status,
            "profile_photo": self.profile_photo,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class CustomerProject(db.Model):
    __tablename__ = 'customer_projects'
    
    id = db.Column(db.Integer, primary_key=True)
    sl_no = db.Column(db.Integer, autoincrement=True, unique=True, nullable=True)
    customer_id = db.Column(db.String(50), unique=True, nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    profile_photo = db.Column(db.String(255), nullable=True, default="https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg")
    email = db.Column(db.String(120), nullable=True)
    phone_number = db.Column(db.String(20), nullable=False)
    district = db.Column(db.String(50), nullable=False)
    place = db.Column(db.String(100), nullable=False)
    capacity_kw = db.Column(db.Numeric(10, 2), nullable=False, default=0.00)
    project_status = db.Column(db.String(20), default='Active')
    
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_service_number = db.Column(db.Integer, default=0, nullable=False)

    # ---- Maintenance-notification tracking (added) ----
    maintenance_count = db.Column(db.Integer, default=0, nullable=False)
    last_maintenance_added_date = db.Column(db.DateTime, nullable=True)


    def to_dict(self):
        return {
            "id": self.id,
            "customer_id": self.customer_id,
            "customer_name": self.customer_name,
            "profile_photo": self.profile_photo,
            "email": self.email,
            "phone_number": self.phone_number,
            "district": self.district,
            "place": self.place,
            "capacity_kw": float(self.capacity_kw) if self.capacity_kw else 0.0,
            "project_status": self.project_status,
            "created_date": self.created_date.isoformat() if self.created_date else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "maintenance_count": self.maintenance_count,
            "last_maintenance_added_date": self.last_maintenance_added_date.isoformat() if self.last_maintenance_added_date else None
        }


class PermissionRequest(db.Model):
    __tablename__ = 'permission_requests'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    module_name = db.Column(db.String(50), nullable=False)           # 'Site Visit'
    permission_type = db.Column(db.String(20), nullable=False)       # 'view', 'update', 'delete'
    status = db.Column(db.String(20), default='Pending')            # 'Pending', 'Approved', 'Rejected'
    requested_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('permissions', lazy=True))


class UserPermission(db.Model):
    __tablename__ = 'user_permissions'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)
    permissions_matrix = db.Column(db.Text, nullable=False, default='{}')
    
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('permission_matrix', uselist=False, cascade="all, delete-orphan"))

    def to_dict(self):
        try:
            matrix = json.loads(self.permissions_matrix) if self.permissions_matrix else {}
        except Exception:
            matrix = {}
        return {
            "user_id": self.user_id,
            "permissions_matrix": matrix,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


class SiteVisit(db.Model):
    __tablename__ = 'site_visits'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    
    panel_capacity = db.Column(db.Numeric(10, 2), nullable=True, default=0.00)
    system_capacity = db.Column(db.Numeric(10, 2), nullable=True, default=0.00)
    feasibility = db.Column(db.String(10), nullable=True, default='Yes')
    project_cost = db.Column(db.Numeric(12, 2), nullable=True, default=0.00)
    location = db.Column(db.Text, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    
    quotation_file = db.Column(db.String(255), nullable=True)
    agreement_file = db.Column(db.String(255), nullable=True)
    aadhaar = db.Column(db.String(255), nullable=True)
    pan = db.Column(db.String(255), nullable=True)
    kseb_bill = db.Column(db.String(255), nullable=True)
    bank_passbook = db.Column(db.String(255), nullable=True)
    land_tax = db.Column(db.String(255), nullable=True)
    building_tax = db.Column(db.String(255), nullable=True)
    signature = db.Column(db.String(255), nullable=True)
    images = db.Column(db.Text, nullable=True)
    
    ownership_change = db.Column(db.String(10), nullable=True, default='No')
    load_enhancement = db.Column(db.String(10), nullable=True, default='No')
    wifi = db.Column(db.String(10), nullable=True, default='No')
    changes = db.Column(db.Text, nullable=True)
    
    work_done = db.Column(db.String(30), default='Pending', nullable=False) # 'Not Initiated' or 'Completed'
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    customer = db.relationship('CustomerProject', backref=db.backref('site_visits', cascade="all, delete-orphan", lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_site_visits')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_site_visits')

    def to_dict(self):
        try:
            parsed_images = json.loads(self.images) if self.images else []
        except:
            parsed_images = []
            
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "panel_capacity": float(self.panel_capacity) if self.panel_capacity else 0.0,
            "system_capacity": float(self.system_capacity) if self.system_capacity else 0.0,
            "feasibility": self.feasibility,
            "project_cost": float(self.project_cost) if self.project_cost else 0.0,
            "location": self.location,
            "comments": self.comments,
            "quotation_file": self.quotation_file,
            "agreement_file": self.agreement_file,
            "aadhaar": self.aadhaar,
            "pan": self.pan,
            "kseb_bill": self.kseb_bill,
            "bank_passbook": self.bank_passbook,
            "land_tax": self.land_tax,
            "building_tax": self.building_tax,
            "signature": self.signature,
            "images": parsed_images,
            "ownership_change": self.ownership_change,
            "load_enhancement": self.load_enhancement,
            "wifi": self.wifi,
            "changes": self.changes,
            "work_done": self.work_done,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_by_name": self.creator.full_name if self.creator else "System",
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_by_name": self.modifier.full_name if self.modifier else "System"
        }
    


class MNREProfile(db.Model):
    __tablename__ = 'mnre_profiles'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    
    # MNRE Dynamic Parameters
    enabled = db.Column(db.Boolean, default=False, nullable=False) # Handled by structural feasibility conditional hook
    mnre_status = db.Column(db.String(50), default='Pending', nullable=False) # 'Pending', 'Completed'
    comments = db.Column(db.Text, nullable=True)
    
    # System Target Verification Files
    feasibility_file = db.Column(db.String(255), nullable=True)
    ack_file = db.Column(db.String(255), nullable=True)

    work_done = db.Column(db.String(30), default='Pending', nullable=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    customer = db.relationship('CustomerProject', backref=db.backref('mnre_profile_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_mnre_profiles')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_mnre_profiles')

    def to_dict(self):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "enabled": self.enabled,
            "mnre_status": self.mnre_status,
            "comments": self.comments,
            "feasibility_file": self.feasibility_file,
            "ack_file": self.ack_file,
            "work_done": self.work_done,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_by_name": self.creator.full_name if self.creator else "System",
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_by_name": self.modifier.full_name if self.modifier else "System"
        }



class MNREInstallation(db.Model):
    __tablename__ = 'mnre_installations'

    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    # --- Installation Trackers ---
    installation_status = db.Column(db.String(50), default='Pending', nullable=False) 
    # Dropdown: Pending, Installation Scheduled, Installation in Progress, Completed, Partially Completed, On Hold
    installation_date = db.Column(db.Date, nullable=True)
    
    
    # --- Approval Trackers ---
    approval_status = db.Column(db.String(50), default='Pending', nullable=False)
    # Dropdown: Pending, Under Verification, Approved, Rejected, Returned for Correction
    approval_date = db.Column(db.Date, nullable=True)
   
    
    # --- Subsidy Trackers ---
    subsidy_status = db.Column(db.String(50), default='Pending', nullable=False)
    # Dropdown: Pending, Processing, Approved, Received, Failed, Returned
    subsidy_amount = db.Column(db.Numeric(12, 2), default=0.00, nullable=False)
    subsidy_received_date = db.Column(db.Date, nullable=True)
    comments = db.Column(db.Text, nullable=True)

    # --- System Metadata Tracks ---
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    work_done = db.Column(db.String(30), default='Pending', nullable=False) # 'Not Initiated' or 'Completed'

    # ---- Added: relationship was missing, needed by check_all_modules_complete() ----
    customer = db.relationship('CustomerProject', backref=db.backref('mnre_installation_rel', cascade="all, delete-orphan", uselist=False, lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "installation_status": self.installation_status,
            "installation_date": self.installation_date.isoformat() if self.installation_date else None,
            "approval_status": self.approval_status,
            "approval_date": self.approval_date.isoformat() if self.approval_date else None,
            "subsidy_status": self.subsidy_status,
            "subsidy_amount": float(self.subsidy_amount),
            "subsidy_received_date": self.subsidy_received_date.isoformat() if self.subsidy_received_date else None,
            "comments": self.comments,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }





class BankLoan(db.Model):
    __tablename__ = 'bank_loans'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    # Core Loan Toggle State
    need_loan = db.Column(db.Boolean, default=False, nullable=False)
    
    
    # Parameters
    jansamarth_status = db.Column(db.String(30), default='Pending', nullable=False)  # 'Pending', 'Completed', 'Partially Done'
    document_submission = db.Column(db.String(50), nullable=True) # 'By Hand', 'Mail', 'By Hand and Mail'
    comment = db.Column(db.Text, nullable=True)
    
    # Payments stored as dynamic installments JSON array: [{"label": "1st Payment", "amount": 25000.0}]
    loan_payments = db.Column(db.Text, nullable=False, default='[]')
    total_loan_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    total_approved_loan_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)  # Computed field: total_approved_loan_amount - total_loan_amount
    
    # File Attachment
    acknowledgement_file = db.Column(db.String(255), nullable=True)
    
    # Workflow Progression Flag
    work_done = db.Column(db.String(30), default='Completed', nullable=False) # 'Not Initiated' or 'Completed'
    
    # Auditing
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    customer = db.relationship('CustomerProject', backref=db.backref('bank_loan_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_loans')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_loans')

    def to_dict(self):
        try:
            parsed_payments = json.loads(self.loan_payments) if self.loan_payments else []
        except Exception:
            parsed_payments = []
            
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "need_loan": self.need_loan,
            "jansamarth_status": self.jansamarth_status,
            "document_submission": self.document_submission,
            "comment": self.comment,
            "loan_payments": parsed_payments,
            "total_approved_loan_amount": float(self.total_approved_loan_amount),
            "total_loan_amount": float(self.total_loan_amount),
            "due_amount": float(self.due_amount),
            "acknowledgement_file": self.acknowledgement_file,
            "work_done": self.work_done,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }



class Payment(db.Model):
    __tablename__ = 'payments'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    # Core Payments
    advance_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    advance_amount_date = db.Column(db.DateTime, nullable=True)
    
    second_payment = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    second_payment_date = db.Column(db.DateTime, nullable=True)
    
    # Dynamic Additional Payments array: [{"label": "3rd Payment", "amount": 15000.0, "date": "2026-03-15"}]
    additional_payments = db.Column(db.Text, nullable=False, default='[]')
    
    # Meta / Audit Details
    payment_method = db.Column(db.String(50), nullable=True) # 'Cash in Hand', 'Online', 'Cheque', or custom text string
    comments = db.Column(db.Text, nullable=True)
    proof_file =db.Column(db.Text)   # Holds path/url to uploaded image or PDF
    total_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)  # Computed field: project_cost - total_amount

    # Workflow Status
    work_done = db.Column(db.String(30), default='Pending', nullable=False) # 'Pending' or 'Completed'
    
    # Auditing
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Relationships
    customer = db.relationship('CustomerProject', backref=db.backref('payment_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_payments')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_payments')

    def to_dict(self):
        # 1. Parse additional payments JSON
        try:
            parsed_additional = json.loads(self.additional_payments) if self.additional_payments else []
        except Exception:
            parsed_additional = []
            
        # 2. Extract external values from joined relationships safely
        loan_amount = 0.0
        if self.customer and self.customer.bank_loan_rel:
            loan_amount = float(self.customer.bank_loan_rel.total_loan_amount)
            
        project_cost = 0.0
        # site_visits is a list backref in your SiteVisit model. Let's get the latest one if it exists.
        if self.customer and self.customer.site_visits:
            # Assumes the last site visit in the list contains the current project cost details
            project_cost = float(self.customer.site_visits[-1].project_cost)

        # 3. Calculate running total amounts
        sum_additional = sum(float(p.get('amount', 0)) for p in parsed_additional)
        total_amount = float(self.advance_amount) + loan_amount + float(self.second_payment) + sum_additional
        
        # 4. Calculate due balance
        due_amount = project_cost - total_amount

        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            
            # Formatted viewing fields
            "advance_amount": float(self.advance_amount),
            "advance_amount_date": self.advance_amount_date.isoformat() if self.advance_amount_date else None,
            "loan_amount": loan_amount,
            "second_payment": float(self.second_payment),
            "second_payment_date": self.second_payment_date.isoformat() if self.second_payment_date else None,
            "additional_payments": parsed_additional,
            
            # Automatic mathematical calculation values
            "total_amount": total_amount,
            "project_cost": project_cost,
            "due_amount": due_amount,
            
            # Attributes
            "payment_method": self.payment_method,
            "proof_file": self.proof_file,
            "work_done": self.work_done,
            
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

    
class KSEB(db.Model):
    __tablename__ = 'kseb'

    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)

    # Core KSEB specific operational attributes
    ownership_status = db.Column(db.String(50), nullable=True)
    ownership_comment = db.Column(db.Text, nullable=True)

    load_enhancement_status = db.Column(db.String(50), nullable=True)
    load_enhancement_comment = db.Column(db.Text, nullable=True)

    feasibility_status = db.Column(db.String(50), default='pending', nullable=False)  # completed, pending, reject, partially done
    fee_paid = db.Column(db.Boolean, default=False, nullable=False)

    # Auditing timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Relationships
    customer = db.relationship('CustomerProject', backref=db.backref('kseb_records', lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_kseb_records')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_kseb_records')
    work_done = db.Column(db.String(50), default='pending', nullable=False)

    def to_dict(self, site_visit_data=None):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "feasibility_status": self.feasibility_status,
            "fee_paid": self.fee_paid,
            "work_done": self.work_done,
            "ownership_status": getattr(self, 'ownership_status', None),
            "ownership_comment": getattr(self, 'ownership_comment', None),
            "load_enhancement_status": getattr(self, 'load_enhancement_status', None),
            "load_enhancement_comment": getattr(self, 'load_enhancement_comment', None),
            "site_visit_flags": site_visit_data or {"ownership_change": False, "load_enhancement": False}
        }





class KsebRegistrationCompletion(db.Model):
    __tablename__ = 'kseb_registration_completion'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    # 1. Registration Submitted
    registration_submitted = db.Column(db.Boolean, default=False, nullable=False)
    registration_date = db.Column(db.DateTime, nullable=True)
    
    # 2. Completion Submitted
    completion_submitted = db.Column(db.Boolean, default=False, nullable=False)
    completion_date = db.Column(db.DateTime, nullable=True)
    
    # 3. Agreement Submitted
    agreement_submitted = db.Column(db.Boolean, default=False, nullable=False)
    agreement_date = db.Column(db.DateTime, nullable=True)
    
    # 4. Payment Done
    payment_done = db.Column(db.Boolean, default=False, nullable=False)
    payment_date = db.Column(db.DateTime, nullable=True)
    
    # 5. Plant Energized
    plant_energized = db.Column(db.Boolean, default=False, nullable=False)
    plant_energized_date = db.Column(db.DateTime, nullable=True)

    # 6. WiFi Configured
    wifi_configured = db.Column(db.Boolean, default=False, nullable=False)
    wifi_configured_date = db.Column(db.DateTime, nullable=True)
    
    # Comments & Miscellaneous
    comments = db.Column(db.Text, nullable=True)

    work_done = db.Column(db.String(30), default='Pending', nullable=False) # 'Not Initiated' or 'Completed'
    
    # Standard Auditing fields
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Relationships
    customer = db.relationship('CustomerProject', backref=db.backref('kseb_registration_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_kseb_regs')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_kseb_regs')

    def to_dict(self):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            
            # Milestones and Ticks matching your exact Frontend state structure
            "registration_submitted": self.registration_submitted,
            "registration_date": self.registration_date.isoformat() if self.registration_date else None,
            
            "completion_submitted": self.completion_submitted,
            "completion_date": self.completion_date.isoformat() if self.completion_date else None,
            
            "agreement_submitted": self.agreement_submitted,
            "agreement_date": self.agreement_date.isoformat() if self.agreement_date else None,
            
            "payment_done": self.payment_done,
            "payment_date": self.payment_date.isoformat() if self.payment_date else None,
            
            "plant_energized": self.plant_energized,
            "plant_energized_date": self.plant_energized_date.isoformat() if self.plant_energized_date else None,

            "wifi_configured": self.wifi_configured,
            "wifi_configured_date": self.wifi_configured_date.isoformat() if self.wifi_configured_date else None,
            
            "comments": self.comments,
            
            "work_done": self.work_done,
            # Audit Data
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

# DCR Certificate Received

# Certificate Claimed

# Certificate Sold / Transferred

# Comments

# DCR Certificate File


class DCRCertificate(db.Model):
    __tablename__ = 'dcr_certificates'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    certificate_received = db.Column(db.Boolean, default=False, nullable=False)
    certificate_claimed = db.Column(db.Boolean, default=False, nullable=False)
    certificate_sold = db.Column(db.Boolean, default=False, nullable=False)
    comments = db.Column(db.Text, nullable=True)
    certificate_file = db.Column(db.String(255), nullable=True)
    work_done = db.Column(db.String(30), default='Pending', nullable=False) # 'Not Initiated' or 'Completed'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    customer = db.relationship('CustomerProject', backref=db.backref('dcr_certificate_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_dcr_certificates')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_dcr_certificates')

    def to_dict(self):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "certificate_received": self.certificate_received,
            "certificate_claimed": self.certificate_claimed,
            "certificate_sold": self.certificate_sold,
            "comments": self.comments,
            "certificate_file": self.certificate_file,
            "work_done": self.work_done,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


# service
# Service Date,Service Type,Technician Name,Complaint / Issue,System Status,Parts Replaced,Next Service Due, image.Comments

class Service(db.Model):
    __tablename__ = 'services'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    
    service_date = db.Column(db.DateTime, nullable=False)
    service_type = db.Column(db.String(50), nullable=False)  # Maintenance, Repair, Inspection
    technician_name = db.Column(db.String(100), nullable=True)
    complaint_issue = db.Column(db.Text, nullable=True)
    system_status = db.Column(db.String(50), nullable=True)  # Operational, Faulty, Needs Attention
    parts_replaced = db.Column(db.Text, nullable=True)  # JSON string of parts replaced
    next_service_due = db.Column(db.DateTime, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    images= db.Column(db.Text, nullable=True)  # JSON string of image URLs or paths
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    service_number = db.Column(db.Integer, nullable=False)
    customer = db.relationship('CustomerProject', backref=db.backref('services', cascade="all, delete-orphan", lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_services')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_services')

    def to_dict(self):
        try:
            parsed_parts_replaced = json.loads(self.parts_replaced) if self.parts_replaced else []
        except Exception:
            parsed_parts_replaced = []

        try:
            parsed_images = json.loads(self.images) if self.images else []
        except Exception:
            parsed_images = []

     
        return {
            "id": self.id,
            "service_number": self.service_number,
            "customer_project_id": self.customer_project_id,
            "service_date": self.service_date.isoformat() if self.service_date else None,
            "service_type": self.service_type,
            "technician_name": self.technician_name,
            "complaint_issue": self.complaint_issue,
            "system_status": self.system_status,
            "parts_replaced": self.parts_replaced,
            "next_service_due": self.next_service_due.isoformat() if self.next_service_due else None,
            "comments": self.comments,
            "images": self.images,
            "created_by": self.created_by,
            "updated_by": self.updated_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class MaterialDelivery(db.Model):
    __tablename__ = "material_deliveries"

    id = db.Column(db.Integer, primary_key=True)

    customer_project_id = db.Column(
        db.Integer,
        db.ForeignKey("customer_projects.id"),
        nullable=False
    )

    # General Information
    delivery_date = db.Column(db.Date, nullable=False)

    electrical_delivered = db.Column(db.Boolean, default=False, nullable=False)
    structure_delivered = db.Column(db.Boolean, default=False, nullable=False)
    panel_delivered = db.Column(db.Boolean, default=False, nullable=False)

    changes = db.Column(db.Text, nullable=True)
    extra_material = db.Column(db.Text, nullable=True)
    structure_changes = db.Column(db.Text, nullable=True)

    delivery_images = db.Column(db.Text, nullable=True)      # JSON
    delivery_document = db.Column(db.String(255), nullable=True)

    delivered_by = db.Column(db.String(100), nullable=True)
    received_by = db.Column(db.String(100), nullable=True)

    comments = db.Column(db.Text, nullable=True)

    work_done = db.Column(
        db.String(30),
        default="Pending",
        nullable=False
    )

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )
    updated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    customer = db.relationship(
        "CustomerProject",
        backref=db.backref(
            "material_delivery_rel",
            cascade="all, delete-orphan",
            uselist=False,
            lazy=True
        )
    )

    creator = db.relationship(
        "User",
        foreign_keys=[created_by],
        backref="created_material_deliveries"
    )

    modifier = db.relationship(
        "User",
        foreign_keys=[updated_by],
        backref="modified_material_deliveries"
    )

    # One Delivery -> Many Material Items
    material_items = db.relationship(
        "MaterialDeliveryItem",
        backref="delivery",
        cascade="all, delete-orphan",
        lazy=True
    )





# 1. Electrical Installation (yes/no)
# 2. Structure Installation (yes/no)
# 3.installation_team(text)
# 4.installation_completion_date(date)
# 5.comments(text)
# 6.showing table(use MaterialDeliveryItem table)
class MaterialInstallation(db.Model):
    __tablename__ = "material_installations"

    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    electrical_installed = db.Column(db.Boolean, default=False, nullable=False)
    structure_installed = db.Column(db.Boolean, default=False, nullable=False)
    installation_team = db.Column(db.String(100), nullable=True)
    installation_completion_date = db.Column(db.Date, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    installation_images = db.Column(db.Text, nullable=True)
    installation_document = db.Column(db.String(255), nullable=True)

    work_done = db.Column(db.String(30), default="Pending", nullable=False)  # 'Not Initiated' or 'Completed'

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    customer = db.relationship(
        "CustomerProject",
        backref=db.backref(
            "material_installation_rel",
            cascade="all, delete-orphan",
            uselist=False,
            lazy=True
        )
    )

    creator = db.relationship(
        "User",
        foreign_keys=[created_by],
        backref="created_material_installations"
    )

    modifier = db.relationship(
        "User",
        foreign_keys=[updated_by],
        backref="modified_material_installations"
    )


class MaterialDeliveryItem(db.Model):
    __tablename__ = "material_delivery_items"

    id = db.Column(db.Integer, primary_key=True)

    material_delivery_id = db.Column(
        db.Integer,
        db.ForeignKey("material_deliveries.id"),
        nullable=False
    )

    sl_no = db.Column(db.Integer, nullable=False)

    material_name = db.Column(db.String(150), nullable=False)

    unit = db.Column(db.String(30), nullable=False)

    quantity = db.Column(db.Float, nullable=False) #delivered_quantity

    used_quantity = db.Column(db.Float, nullable=True, default=0.0)

    remaining_quantity = db.Column(db.Float, nullable=True, default=0.0)

    work_done = db.Column(
        db.String(30),
        default="Pending",
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow
    )

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )



class CustomerAuditLog(db.Model):
    __tablename__ = 'customer_audit_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    action = db.Column(db.String(50), nullable=False)  # CREATE, UPDATE, DELETE
    module_name = db.Column(db.String(50), nullable=False)  # Site Visit
    changes_payload = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
    customer = db.relationship('CustomerProject', backref=db.backref('audit_logs', cascade="all, delete-orphan", lazy=True))
    user = db.relationship('User', backref=db.backref('action_logs', lazy=True))

    def to_dict(self):
        try:
            parsed_changes = json.loads(self.changes_payload) if self.changes_payload else {}
        except Exception:
            parsed_changes = {}
            
        summary_fields = list(parsed_changes.keys())
        
        formatted_date_time = None
        if self.timestamp:
            formatted_date_time = self.timestamp.strftime("%d/%m/%Y %I:%M:%S %p").lower()

        return {
            "id": self.id,
            "customer_name": self.customer.customer_name if self.customer else "Unknown",
            "username": self.user.full_name if self.user else "System",
            "page": self.module_name.lower().replace(" ", ""),
            "action": self.action.lower(),
            "summary": summary_fields,
            "updated date and time": formatted_date_time
        }

class PushSubscription(db.Model):
    __tablename__ = 'push_subscriptions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # nullable = anonymous subscribers allowed
    endpoint = db.Column(db.String(500), unique=True, nullable=False)
    p256dh = db.Column(db.String(200), nullable=False)
    auth = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('push_subscriptions', cascade="all, delete-orphan", lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "endpoint": self.endpoint,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class Notification(db.Model):
    __tablename__ = 'notifications'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    title = db.Column(db.String(150), nullable=False)
    message = db.Column(db.Text, nullable=False)
    url = db.Column(db.String(255), nullable=True, default='/')
    notif_type = db.Column(db.String(30), nullable=False, default='general')  # NEW: payment, staff, kseb, customer, general
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # ---- Added: links a notification back to the customer it's about, so
    # the daily-cap check and click-through URL both have something solid to
    # key off, instead of parsing the message/url strings. ----
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=True)

    user = db.relationship('User', backref=db.backref('notifications', cascade="all, delete-orphan", lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "message": self.message,
            "url": self.url,
            "notif_type": self.notif_type,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() + 'Z' if self.created_at else None,  # ADD 'Z'
            "customer_project_id": self.customer_project_id
        }