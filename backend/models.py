from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import json

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone_number = db.Column(db.String(20), nullable=True)
    password = db.Column(db.String(255), nullable=False)
    profile_photo = db.Column(db.String(255), nullable=True)
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

    feasibility_notified_date = db.Column(db.Date, nullable=True)
    
    created_date = db.Column(db.DateTime, default=datetime.utcnow)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_service_number = db.Column(db.Integer, default=0, nullable=False)

    # ---- Maintenance-notification tracking (added) ----
    maintenance_count = db.Column(db.Integer, default=0, nullable=False)
    last_maintenance_added_date = db.Column(db.DateTime, nullable=True)

    # ADDED: set once (first time only) by check_first_maintenance_due() the
    # moment check_all_modules_complete() first returns True for this
    # customer. Anchors the "first maintenance due 6 months after everything
    # is complete" countdown to a fixed point in time, so it doesn't drift if
    # someone edits an already-complete module's fields later (which would
    # bump that module's own updated_at).
    modules_completed_at = db.Column(db.DateTime, nullable=True)

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
            "feasibility_notified_date":self.feasibility_notified_date,
            "created_date": self.created_date.isoformat() if self.created_date else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "maintenance_count": self.maintenance_count,
            "last_maintenance_added_date": self.last_maintenance_added_date.isoformat() if self.last_maintenance_added_date else None,
            "modules_completed_at": self.modules_completed_at.isoformat() if self.modules_completed_at else None
        }


class PermissionRequest(db.Model):
    __tablename__ = 'permission_requests'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    module_name = db.Column(db.String(50), nullable=False)
    permission_type = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), default='Pending')
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
    # unique=True: one SiteVisit row per customer, enforced at the DB level.
    # Without this, two near-simultaneous saves (double-click / retry) can
    # both see "no existing visit" and both INSERT, leaving two rows for the
    # same customer. .first() then has no reliable way to know which row is
    # "current", so GET/UPDATE can silently pick the stale one -> values
    # look like they "revert to a previous update".
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
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
    visited_date = db.Column(db.DateTime, default=datetime.utcnow)
    
    work_done = db.Column(db.String(30), default='Pending', nullable=False)
    
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
            "visited_date": self.visited_date.isoformat() if self.visited_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_by_name": self.creator.full_name if self.creator else "System",
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_by_name": self.modifier.full_name if self.modifier else "System"
        }
    


class MNREProfile(db.Model):
    __tablename__ = 'mnre_profiles'
    
    id = db.Column(db.Integer, primary_key=True)
    # unique=True: relationship below is uselist=False (one MNREProfile per
    # customer) but the FK wasn't enforcing that at the DB level - same
    # duplicate-row risk as SiteVisit had.
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    enabled = db.Column(db.Boolean, default=False, nullable=False)
    mnre_status = db.Column(db.String(50), default='Pending', nullable=False)
    comments = db.Column(db.Text, nullable=True)
    
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
    
    installation_status = db.Column(db.String(50), default='Pending', nullable=False) 
    installation_date = db.Column(db.Date, nullable=True)
    
    
    approval_status = db.Column(db.String(50), default='Pending', nullable=False)
    approval_date = db.Column(db.Date, nullable=True)
   
    
    subsidy_status = db.Column(db.String(50), default='Pending', nullable=False)
    subsidy_amount = db.Column(db.Numeric(12, 2), default=0.00, nullable=False)
    subsidy_received_date = db.Column(db.Date, nullable=True)
    comments = db.Column(db.Text, nullable=True)

    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    work_done = db.Column(db.String(30), default='Pending', nullable=False)

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
    
    need_loan = db.Column(db.Boolean, default=False, nullable=False)
    
    
    jansamarth_status = db.Column(db.String(30), default='Pending', nullable=False)
    document_submission = db.Column(db.String(50), nullable=True)
    comment = db.Column(db.Text, nullable=True)
    
    loan_payments = db.Column(db.Text, nullable=False, default='[]')
    total_loan_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    total_approved_loan_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    
    acknowledgement_file = db.Column(db.String(255), nullable=True)
    
    work_done = db.Column(db.String(30), default='Completed', nullable=False)
    
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
    
    advance_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    advance_amount_date = db.Column(db.DateTime, nullable=True)
    
    second_payment = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    second_payment_date = db.Column(db.DateTime, nullable=True)
    
    additional_payments = db.Column(db.Text, nullable=False, default='[]')
    
    payment_method = db.Column(db.String(50), nullable=True)
    comments = db.Column(db.Text, nullable=True)
    proof_file =db.Column(db.Text)
    total_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)
    due_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0.00)

    work_done = db.Column(db.String(30), default='Pending', nullable=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    customer = db.relationship('CustomerProject', backref=db.backref('payment_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_payments')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_payments')

    def to_dict(self):
        try:
            parsed_additional = json.loads(self.additional_payments) if self.additional_payments else []
        except Exception:
            parsed_additional = []
            
        loan_amount = 0.0
        if self.customer and self.customer.bank_loan_rel and self.customer.bank_loan_rel.need_loan:
            loan_amount = float(self.customer.bank_loan_rel.total_loan_amount or 0.0)
            
        # NOTE: fetch latest by created_at explicitly - list order on a
        # backref with no order_by is not guaranteed by SQLAlchemy.
        project_cost = 0.0
        latest_visit = (
            SiteVisit.query.filter_by(customer_project_id=self.customer_project_id)
            .order_by(SiteVisit.created_at.desc()).first()
        )
        if latest_visit:
            project_cost = float(latest_visit.project_cost)

        sum_additional = sum(float(p.get('amount', 0)) for p in parsed_additional)
        total_amount = float(self.advance_amount) + loan_amount + float(self.second_payment) + sum_additional
        
        due_amount = project_cost - total_amount

        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            
            "advance_amount": float(self.advance_amount),
            "advance_amount_date": self.advance_amount_date.isoformat() if self.advance_amount_date else None,
            "loan_amount": loan_amount,
            "second_payment": float(self.second_payment),
            "second_payment_date": self.second_payment_date.isoformat() if self.second_payment_date else None,
            "additional_payments": parsed_additional,
            
            "total_amount": total_amount,
            "project_cost": project_cost,
            "due_amount": due_amount,
            
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

    ownership_status = db.Column(db.String(50), nullable=True)
    ownership_comment = db.Column(db.Text, nullable=True)

    load_enhancement_status = db.Column(db.String(50), nullable=True)
    load_enhancement_comment = db.Column(db.Text, nullable=True)

    feasibility_status = db.Column(db.String(50), default='pending', nullable=False)
    fee_paid = db.Column(db.Boolean, default=False, nullable=False)
    payment_date = db.Column(db.DateTime, nullable=True)
    visiter_name = db.Column(db.String(100), nullable=True) 

    comments = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # CHANGED: added cascade="all, delete-orphan" — without it, SQLAlchemy's
    #   psycopg2.errors.NotNullViolation: null value in column
    #   "customer_project_id" of relation "kseb" violates not-null constraint
    # Every other module relationship below already had this cascade set —
    customer = db.relationship('CustomerProject', backref=db.backref('kseb_records', cascade="all, delete-orphan", lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_kseb_records')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_kseb_records')
    work_done = db.Column(db.String(50), default='Pending', nullable=False)

    def to_dict(self, site_visit_data=None):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "feasibility_status": self.feasibility_status,
            "fee_paid": self.fee_paid,
            "comments": self.comments,
            "payment_date": self.payment_date.isoformat() if self.payment_date else None,
            "visiter_name": self.visiter_name,
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
    
    registration_submitted = db.Column(db.Boolean, default=False, nullable=False)
    registration_date = db.Column(db.DateTime, nullable=True)
    
    completion_submitted = db.Column(db.Boolean, default=False, nullable=False)
    completion_date = db.Column(db.DateTime, nullable=True)
    
    agreement_submitted = db.Column(db.Boolean, default=False, nullable=False)
    agreement_date = db.Column(db.DateTime, nullable=True)
    
    payment_done = db.Column(db.Boolean, default=False, nullable=False)
    payment_date = db.Column(db.DateTime, nullable=True)
    
    plant_energized = db.Column(db.Boolean, default=False, nullable=False)
    plant_energized_date = db.Column(db.DateTime, nullable=True)

    wifi_configured = db.Column(db.Boolean, default=False, nullable=False)
    wifi_configured_date = db.Column(db.DateTime, nullable=True)
    
    comments = db.Column(db.Text, nullable=True)

    work_done = db.Column(db.String(30), default='Pending', nullable=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    customer = db.relationship('CustomerProject', backref=db.backref('kseb_registration_rel', cascade="all, delete-orphan", uselist=False, lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='created_kseb_regs')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_kseb_regs')

    def to_dict(self):
        return {
            "id": self.id,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            
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
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


class DCRCertificate(db.Model):
    __tablename__ = 'dcr_certificates'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    
    certificate_received = db.Column(db.Boolean, default=False, nullable=False)
    certificate_claimed = db.Column(db.Boolean, default=False, nullable=False)
    certificate_sold = db.Column(db.Boolean, default=False, nullable=False)
    comments = db.Column(db.Text, nullable=True)
    certificate_file = db.Column(db.String(255), nullable=True)
    work_done = db.Column(db.String(30), default='Pending', nullable=False)
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


class Service(db.Model):
    __tablename__ = 'services'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    
    service_date = db.Column(db.DateTime, nullable=False)
    service_type = db.Column(db.String(50), nullable=False)
    technician_name = db.Column(db.String(100), nullable=True)
    complaint_issue = db.Column(db.Text, nullable=True)
    system_status = db.Column(db.String(50), nullable=True)
    parts_replaced = db.Column(db.Text, nullable=True)
    next_service_due = db.Column(db.DateTime, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    images= db.Column(db.Text, nullable=True)
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

    # unique=True: relationship below is uselist=False (one delivery record
    # per customer) but the FK wasn't enforcing that at the DB level - same
    # duplicate-row risk as SiteVisit had.
    customer_project_id = db.Column(
        db.Integer,
        db.ForeignKey("customer_projects.id"),
        nullable=False,
        unique=True
    )

    # nullable=True: this gets auto-created as a bare stub (see
    # update_material_delivery in material.py) as soon as material items are
    # entered via MaterialItem.jsx, before the user has touched the actual
    # "Delivery Date" field. It used to be NOT NULL, which forced the stub
    # to be filled with today's date as a placeholder - so the date field
    # showed a date the user never entered, on a delivery they hadn't
    # edited yet.
    delivery_date = db.Column(db.Date, nullable=True)

    electrical_delivered = db.Column(db.Boolean, default=False, nullable=False)
    structure_delivered = db.Column(db.Boolean, default=False, nullable=False)
    panel_delivered = db.Column(db.Boolean, default=False, nullable=False)

    changes = db.Column(db.Text, nullable=True)
    extra_material = db.Column(db.Text, nullable=True)
    structure_changes = db.Column(db.Text, nullable=True)

    delivery_images = db.Column(db.Text, nullable=True)
    # Text, not String(255): this stores a JSON-encoded LIST of document URLs
    # (see material.py's _upload_documents / create_material_delivery /
    # update_material_delivery), not a single URL. String(255) overflows as
    # soon as 2+ documents are uploaded (Cloudinary URLs run ~80-120 chars
    # each), causing a DB error on save or a truncated/corrupt JSON value.
    delivery_document = db.Column(db.Text, nullable=True)

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

    material_items = db.relationship(
        "MaterialDeliveryItem",
        backref="delivery",
        cascade="all, delete-orphan",
        lazy=True
    )


class MaterialInstallation(db.Model):
    __tablename__ = "material_installations"

    id = db.Column(db.Integer, primary_key=True)
    # unique=True: relationship below is uselist=False (one installation
    # record per customer) but the FK wasn't enforcing that at the DB level -
    # same duplicate-row risk as SiteVisit had.
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False, unique=True)
    electrical_installed = db.Column(db.Boolean, default=False, nullable=False)
    structure_installed = db.Column(db.Boolean, default=False, nullable=False)
    installation_team = db.Column(db.String(100), nullable=True)
    installation_completion_date = db.Column(db.Date, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    installation_images = db.Column(db.Text, nullable=True)
    installation_document = db.Column(db.String(255), nullable=True)

    work_done = db.Column(db.String(30), default="Pending", nullable=False)

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

    category = db.Column(db.String(20), nullable=False, default="Electrical")

    quantity = db.Column(db.Float, nullable=False)

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


class Complaint(db.Model):
    
    __tablename__ = 'complaints'

    SLA_HOURS = {'Urgent': 4, 'High': 24, 'Medium': 72, 'Low': 120}

    # ---- Priority-based reminder escalation schedule (added) ----
    # Each entry: (days_elapsed_threshold, notifications_per_day_from_then_on).
    # The *highest* threshold the complaint has crossed (based on
    # reminder_anchor_at, not created_at - see reset_reminder_clock) wins.
    # e.g. Medium at day 2 -> 1/day, and once day 7 is reached -> 2/day.
    REMINDER_SCHEDULE = {
        'Low':    [(3, 1)],
        'Medium': [(2, 1), (7, 2)],
        'High':   [(1, 1), (5, 2)],
        'Urgent': [(1, 3), (5, 4)],
    }

    id = db.Column(db.Integer, primary_key=True)
    complaint_number = db.Column(db.String(20), unique=True, nullable=False)

    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)

    subject = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=False)

    category = db.Column(db.String(30), nullable=False, default='Other')
    priority = db.Column(db.String(10), nullable=False, default='Medium')

    # independently afterwards - this is a note on the complaint itself, it
    district_snapshot = db.Column(db.String(50), nullable=True)
    place_snapshot = db.Column(db.String(100), nullable=True)

    status = db.Column(db.String(20), nullable=False, default='Open')

    resolution_notes = db.Column(db.Text, nullable=True)

    # CHANGED: a complaint can now have multiple assignees - see
    # ComplaintAssignee below. The old single assigned_to FK column is gone;
    # use .assignees / .assignee_ids / .is_assigned instead.
    resolved_at = db.Column(db.DateTime, nullable=True)
    closed_at = db.Column(db.DateTime, nullable=True)

    sla_due_at = db.Column(db.DateTime, nullable=True)
    reopen_count = db.Column(db.Integer, nullable=False, default=0)

    # ---- Reminder-clock tracking (added) ----
    # The point in time the escalation schedule counts "days elapsed" from.
    # Set on creation; reset to "now" on reopen so a reopened complaint
    # doesn't immediately jump to an escalated notify rate just because the
    # elapsed time since the *original* creation is already large. Actual
    # send throttling/spacing reuses notification_rules.can_send_today()
    # against the Notification table (same mechanism every other periodic
    # check in that file already uses) rather than duplicating counters here.
    reminder_anchor_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    customer = db.relationship('CustomerProject', backref=db.backref('complaints', cascade="all, delete-orphan", lazy=True))
    creator = db.relationship('User', foreign_keys=[created_by], backref='registered_complaints')
    modifier = db.relationship('User', foreign_keys=[updated_by], backref='modified_complaints')

    CLOSED_STATUSES = ('Resolved', 'Closed')

    # ---- Multi-assignee helpers (added) ----
    @property
    def assignees(self):
        """User objects currently assigned to this complaint."""
        return [ca.user for ca in self.assignee_links if ca.user]

    @property
    def assignee_ids(self):
        return [ca.user_id for ca in self.assignee_links]

    @property
    def is_assigned(self):
        return len(self.assignee_links) > 0

    def compute_sla_due_at(self, from_time=None):
        """Recompute sla_due_at from the current priority. Call this on
        create, and again whenever priority changes on a still-open complaint."""
        base = from_time or self.created_at or datetime.utcnow()
        hours = self.SLA_HOURS.get(self.priority, self.SLA_HOURS['Medium'])
        self.sla_due_at = base + timedelta(hours=hours)
        return self.sla_due_at

    def reset_reminder_clock(self, at=None):
        """Restart the escalation countdown from scratch. Call on create and
        on reopen (see notes on reminder_anchor_at above)."""
        self.reminder_anchor_at = at or datetime.utcnow()

    def current_reminder_rate(self, now=None):
        """How many reminder notifications/day this complaint should be
        getting right now, based on priority + days elapsed since
        reminder_anchor_at. 0 means no reminders due yet (or complaint is
        closed / has no anchor)."""
        if self.status in self.CLOSED_STATUSES or not self.reminder_anchor_at:
            return 0
        now = now or datetime.utcnow()
        elapsed_days = (now - self.reminder_anchor_at).days
        rate = 0
        for min_days, per_day in self.REMINDER_SCHEDULE.get(self.priority, []):
            if elapsed_days >= min_days:
                rate = per_day
        return rate

    @property
    def is_overdue(self):
        if self.status in self.CLOSED_STATUSES:
            return False
        if not self.sla_due_at:
            return False
        return datetime.utcnow() > self.sla_due_at

    def to_dict(self):
        attachments = sorted(self.attachments, key=lambda a: a.uploaded_at or datetime.min) if self.attachments else []
        comments = sorted(self.comments, key=lambda c: c.created_at or datetime.min) if self.comments else []
        assignees = self.assignees

        return {
            "id": self.id,
            "complaint_number": self.complaint_number,
            "customer_project_id": self.customer_project_id,
            "customer_id": self.customer.customer_id if self.customer else None,
            "customer_name": self.customer.customer_name if self.customer else None,
            "customer_phone": self.customer.phone_number if self.customer else None,
            "subject": self.subject,
            "description": self.description,
            "category": self.category,
            "priority": self.priority,
            "district_snapshot": self.district_snapshot,
            "place_snapshot": self.place_snapshot,
            "status": self.status,
            "attachments": [a.to_dict() for a in attachments],
            "comments": [c.to_dict() for c in comments],
            "comments_count": len(comments),
            "resolution_notes": self.resolution_notes,
            # CHANGED: multi-assignee. "assigned_to" is kept (first assignee,
            # or None) only so any not-yet-updated frontend code doesn't
            # crash; prefer "assignees" / "assignee_ids" going forward.
            "assigned_to": assignees[0].id if assignees else None,
            "assigned_staff_name": assignees[0].full_name if assignees else None,
            "assignees": [{"id": u.id, "full_name": u.full_name} for u in assignees],
            "assignee_ids": [u.id for u in assignees],
            "created_by": self.created_by,
            "created_by_name": self.creator.full_name if self.creator else None,
            "sla_due_at": self.sla_due_at.isoformat() if self.sla_due_at else None,
            "is_overdue": self.is_overdue,
            "reopen_count": self.reopen_count,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


class ComplaintAssignee(db.Model):
    """Join table for multi-staff assignment on a complaint (added).

    Replaces the old single Complaint.assigned_to FK column. A unique
    constraint on (complaint_id, user_id) stops the same staff member being
    assigned twice to the same complaint.
    """
    __tablename__ = 'complaint_assignees'
    __table_args__ = (
        db.UniqueConstraint('complaint_id', 'user_id', name='uq_complaint_assignee'),
    )

    id = db.Column(db.Integer, primary_key=True)
    complaint_id = db.Column(db.Integer, db.ForeignKey('complaints.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    assigned_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    assigned_at = db.Column(db.DateTime, default=datetime.utcnow)

    complaint = db.relationship('Complaint', backref=db.backref('assignee_links', cascade="all, delete-orphan", passive_deletes=True, lazy=True))
    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('assigned_complaint_links', lazy=True))
    assigner = db.relationship('User', foreign_keys=[assigned_by])

    def to_dict(self):
        return {
            "id": self.id,
            "complaint_id": self.complaint_id,
            "user_id": self.user_id,
            "full_name": self.user.full_name if self.user else None,
            "assigned_by": self.assigned_by,
            "assigned_at": self.assigned_at.isoformat() if self.assigned_at else None,
        }


class ComplaintAttachment(db.Model):
    __tablename__ = 'complaint_attachments'

    id = db.Column(db.Integer, primary_key=True)
    complaint_id = db.Column(db.Integer, db.ForeignKey('complaints.id', ondelete='CASCADE'), nullable=False)

    file_url = db.Column(db.String(500), nullable=False)
    file_name = db.Column(db.String(255), nullable=True)

    uploaded_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    complaint = db.relationship('Complaint', backref=db.backref('attachments', cascade="all, delete-orphan", passive_deletes=True, lazy=True))
    uploader = db.relationship('User', foreign_keys=[uploaded_by])

    def to_dict(self):
        return {
            "id": self.id,
            "complaint_id": self.complaint_id,
            "file_url": self.file_url,
            "file_name": self.file_name,
            "uploaded_by": self.uploaded_by,
            "uploaded_by_name": self.uploader.full_name if self.uploader else None,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None
        }


class ComplaintComment(db.Model):
    __tablename__ = 'complaint_comments'

    id = db.Column(db.Integer, primary_key=True)
    complaint_id = db.Column(db.Integer, db.ForeignKey('complaints.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    message = db.Column(db.Text, nullable=False)
    # Internal notes are staff-only remarks (e.g. investigation notes) as
    is_internal = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    complaint = db.relationship('Complaint', backref=db.backref('comments', cascade="all, delete-orphan", passive_deletes=True, lazy=True))
    user = db.relationship('User', foreign_keys=[user_id])

    def to_dict(self):
        return {
            "id": self.id,
            "complaint_id": self.complaint_id,
            "user_id": self.user_id,
            "user_name": self.user.full_name if self.user else None,
            "message": self.message,
            "is_internal": self.is_internal,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class CustomerAuditLog(db.Model):
    __tablename__ = 'customer_audit_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    action = db.Column(db.String(50), nullable=False)
    module_name = db.Column(db.String(50), nullable=False)
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
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
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

    # ADDED: composite index matching the exact filter+order pattern used by
    # Without this, that query does a full table scan on every single check,
    # sort column, so the index can serve both the filter and the ORDER BY.
    __table_args__ = (
        db.Index(
            'ix_notifications_customer_notiftype_created',
            'customer_project_id', 'notif_type', 'created_at'
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    title = db.Column(db.String(150), nullable=False)
    message = db.Column(db.Text, nullable=False)
    url = db.Column(db.String(255), nullable=True, default='/')
    notif_type = db.Column(db.String(250), nullable=False, default='general')
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # ---- Popup queue tracking (added) ----
    # popup_seen: user closed it themselves (X icon / OK button)
    # popup_resolved: system auto-cleared it because the underlying work it
    # was about is now complete (e.g. the delay it warned about got fixed),
    # so it silently drops out of the queue without ever popping up.
    # Kept separate from is_read - bell/read state is untouched either way.
    popup_seen = db.Column(db.Boolean, default=False, nullable=False)
    popup_resolved = db.Column(db.Boolean, default=False, nullable=False)

    # ---- Added: links a notification back to the customer it's about, so
    customer_project_id = db.Column(db.Integer, db.ForeignKey('customer_projects.id', ondelete='CASCADE'), nullable=True)

    user = db.relationship('User', backref=db.backref('notifications', cascade="all, delete-orphan", lazy=True))

    # CHANGED (fix): customer_project_id had a ForeignKey column but no
    # cascade instruction anywhere (ORM or DB) for what to do with a
    #   psycopg2.errors.ForeignKeyViolation: update or delete on table
    #   "customer_projects" violates foreign key constraint
    # Every other module below already has this pattern (cascade="all,
    customer = db.relationship('CustomerProject', backref=db.backref('customer_notifications', cascade="all, delete-orphan", passive_deletes=True, lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "message": self.message,
            "url": self.url,
            "notif_type": self.notif_type,
            "is_read": self.is_read,
            "popup_seen": self.popup_seen,
            "popup_resolved": self.popup_resolved,
            "created_at": self.created_at.isoformat() + 'Z' if self.created_at else None,
            "customer_project_id": self.customer_project_id
        }

class SupplementDocument(db.Model):
    __tablename__ = 'supplement_documents'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=True)
    file_url = db.Column(db.String(500), nullable=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.title, 
            "description": self.description,
            "url": self.file_url,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }