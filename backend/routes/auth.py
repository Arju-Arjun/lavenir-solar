import os
from flask import request, jsonify, Blueprint, current_app
from flask_jwt_extended import create_access_token
from werkzeug.security import check_password_hash, generate_password_hash
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from models import db, User
from utils import send_reset_email

auth_bp = Blueprint('auth', __name__)

RESET_TOKEN_SALT = 'password-reset-salt'
RESET_TOKEN_MAX_AGE = 900  # 15 minutes


def _get_serializer():
    return URLSafeTimedSerializer(current_app.config['JWT_SECRET_KEY'])

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


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email') if data else None

    

    if not email:
        return jsonify({"status": "error", "message": "Email is required!"}), 400

    # verify that email in db
    if not User.query.filter_by(email=email).first():
        return jsonify({"status": "error", "message": "Email not found!"}), 404

    user = User.query.filter_by(email=email).first()

    # Always return the same success message whether or not the email
    # exists, so the endpoint can't be used to check which emails are registered.
    if user:
        token = _get_serializer().dumps(email, salt=RESET_TOKEN_SALT)
        client_url = os.getenv('CLIENT_URL')
        reset_link = f"{client_url}/reset-password/{token}"
        try:
            send_reset_email(email, reset_link)
        except Exception as e:
            print(f"Failed to send reset email to {email}: {str(e)}")

    return jsonify({
        "status": "success",
        "message": "If that email is registered, a password reset link has been sent."
    }), 200


@auth_bp.route('/reset-password/<token>', methods=['POST'])
def reset_password(token):
    data = request.get_json()
    new_password = data.get('password') if data else None

    if not new_password:
        return jsonify({"status": "error", "message": "Password is required!"}), 400

    try:
        email = _get_serializer().loads(token, salt=RESET_TOKEN_SALT, max_age=RESET_TOKEN_MAX_AGE)
    except SignatureExpired:
        return jsonify({"status": "error", "message": "This reset link has expired. Please request a new one."}), 400
    except BadSignature:
        return jsonify({"status": "error", "message": "This reset link is invalid."}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"status": "error", "message": "User not found."}), 404

    user.password = generate_password_hash(new_password)
    db.session.commit()

    return jsonify({"status": "success", "message": "Password has been reset successfully."}), 200