from flask import request, jsonify, Blueprint
from flask_jwt_extended import create_access_token
from werkzeug.security import check_password_hash
from models import db, User

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"status": "error", "message": "Email and password are required!"}), 400

    user = User.query.filter_by(email=email).first()

    if not user or not check_password_hash(user.password, password):
        return jsonify({"status": "error", "message": "Invalid email or password!"}), 401

    if user.status == 'Inactive':
        return jsonify({"status": "error", "message": "Your account is inactive. Please contact the administrator."}), 403

    additional_claims = {"role": user.role}
    access_token = create_access_token(identity=str(user.id), additional_claims=additional_claims)

    return jsonify({
        "status": "success",
        "token": access_token,
        "role": user.role,
        "user": user.to_dict()
    }), 200