from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash
from datetime import datetime
from models import db, User 

staff_bp = Blueprint('staff_bp', __name__)

def generate_unique_employee_id():
    """
    Generates an automated, sequential employee ID.
    Format: EMP-YYYY-XXXX (e.g., EMP-2026-0001)
    """
    current_year = datetime.utcnow().year
    prefix = f"EMP-{current_year}-"
    
    # Find the most recently created staff member with an ID matching the current year
    last_staff = User.query.filter(
        User.role == "staff",
        User.employee_id.like(f"{prefix}%")
    ).order_by(User.id.desc()).first()
    
    if last_staff and last_staff.employee_id:
        try:
            # Extract the sequential numeric suffix and increment it
            last_sequence = int(last_staff.employee_id.split("-")[-1])
            new_sequence = last_sequence + 1
        except (ValueError, IndexError):
            new_sequence = 1
    else:
        new_sequence = 1
        
    # Pad out the sequence number with leading zeros (4 digits)
    return f"{prefix}{new_sequence:04d}"

# ==========================================
# ➕ CREATE: ADD NEW STAFF MEMBER
# ==========================================
@staff_bp.route('/add', methods=['POST'])
def add_new_staff():
    data = request.get_json() or {}
    
    full_name = data.get('full_name')
    email = data.get('email')
    phone_number = data.get('phone_number')
    password = data.get('password')
    department = data.get('department')
    
    # Required field validation
    if not all([full_name, email, password]):
        return jsonify({"error": "Full name, email, and password are required."}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "A user with this email already exists."}), 400

    try:
        automated_emp_id = generate_unique_employee_id()
        hashed_password = generate_password_hash(password)
        
        new_staff = User(
            full_name=full_name,
            role="staff",
            email=email,
            phone_number=phone_number,
            password=hashed_password,
            employee_id=automated_emp_id,
            department=department,
            admin_id=None,
            status="Active"
        )
        
        db.session.add(new_staff)
        db.session.commit()
        
        return jsonify({
            "message": f"Staff member created successfully with ID: {automated_emp_id}",
            "staff": new_staff.to_dict()
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "An error occurred while saving. Please try again.", "details": str(e)}), 500


# ==========================================
# 🔍 READ: GET ALL STAFF MEMBERS (Active + Suspended)
# ==========================================
@staff_bp.route('/all', methods=['GET'])
def get_all_staff():
    try:
        # Return every staff record regardless of status. Suspend (status =
        # 'Inactive') is meant to be a reversible, visible state — the row
        # should stay in the directory with a "Suspended" badge, not disappear.
        # Previously this filtered out User.status != 'Inactive', which made
        # suspending someone behave exactly like deleting them from the list.
        # The frontend's Status dropdown (All / Active / Suspended) now owns
        # visibility filtering instead of the API hiding rows outright.
        staff_members = User.query.filter(
            User.role == 'staff'
        ).all()
        
        staff_list = [staff.to_dict() for staff in staff_members]
        return jsonify(staff_list), 200
    except Exception as e:
        return jsonify({"error": "An error occurred while fetching staff members.", "details": str(e)}), 500
    
    
# ==========================================
# 🔄 UPDATE: EDIT EXISTING STAFF BY ID
# ==========================================
@staff_bp.route('/update/<int:user_id>', methods=['PUT'])
def update_staff(user_id):
    data = request.get_json() or {}
    
    # Locate target profile matching path parameter key
    staff_member = User.query.filter_by(id=user_id, role='staff').first()
    
    if not staff_member:
        return jsonify({"error": "Staff member profile not found."}), 404
        
    email = data.get('email')
    
    # Enforce uniqueness constraint check if payload seeks to modify email field
    if email and email != staff_member.email:
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "This email address is already claimed by another user profile."}), 400

    try:
        if 'full_name' in data:
            staff_member.full_name = data['full_name']
        if 'email' in data:
            staff_member.email = data['email']
        if 'phone_number' in data:
            staff_member.phone_number = data['phone_number']
        if 'department' in data:
            staff_member.department = data['department']
        if 'status' in data:
            staff_member.status = data['status']
            
        # if 'password' in data and data['password'].strip():
        #     staff_member.password = generate_password_hash(data['password'])

        db.session.commit()
        
        return jsonify({
            "message": "Staff member profile was successfully updated.",
            "staff": staff_member.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "An error occurred while running data transformations.", "details": str(e)}), 500
    

def _scrub_user_foreign_keys(user_id):
    """
    Every table that references users.id (created_by, updated_by,
    user_id, ...) needs to be dealt with before a User row can actually
    be deleted, or Postgres raises a ForeignKeyViolation the moment this
    staff member has touched any site visit, audit log, notification,
    permission, etc.

    Rather than hand-listing every table here (and having to remember to
    update this again every time a new created_by/updated_by column gets
    added somewhere else in the app), this walks the real schema
    metadata for any FK pointing at users.id:

      - nullable columns (SiteVisit.created_by, CustomerAuditLog.user_id,
        Notification.user_id, PushSubscription.user_id, ...) get set to
        NULL so the record survives without the user link. to_dict()
        methods on these already tolerate a missing user.
      - non-nullable columns (PermissionRequest.user_id,
        UserPermission.user_id) can't be nulled out, so those rows are
        deleted along with the user - they don't mean anything without
        the staff member they belong to.
    """
    for table in db.metadata.tables.values():
        if table.name == 'users':
            continue
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == 'users' and fk.column.name == 'id':
                    if column.nullable:
                        db.session.execute(
                            table.update()
                            .where(column == user_id)
                            .values({column.name: None})
                        )
                    else:
                        db.session.execute(
                            table.delete().where(column == user_id)
                        )


# ==========================================
# ❌ PERMANENT DELETE
# ==========================================
@staff_bp.route('/delete/<int:user_id>', methods=['DELETE'])
def delete_staff(user_id):
    staff_member = User.query.filter_by(id=user_id, role='staff').first()

    if not staff_member:
        return jsonify({"error": "Staff member profile not found."}), 404

    try:
        staff_name = staff_member.full_name

        # Clear/collapse every foreign key pointing at this user first,
        # otherwise the delete below fails on the first table with a
        # NOT NULL or unresolved FK constraint against users.id.
        _scrub_user_foreign_keys(user_id)

        db.session.delete(staff_member)
        db.session.commit()
        return jsonify({"message": f"Staff member '{staff_name}' has been permanently deleted."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "An error occurred while attempting to delete the staff member.", "details": str(e)}), 500