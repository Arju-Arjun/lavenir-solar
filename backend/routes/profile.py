from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User
from utils import upload_to_r2, delete_r2_file, sanitize_path_segment
import base64
import io
import time

profile_bp = Blueprint('profile', __name__)

MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB - keep well under R2's per-request comfort zone


def _get_file_size(file_storage):
    """Return size in bytes of a Werkzeug FileStorage without consuming the stream."""
    file_storage.seek(0, 2)  # seek to end
    size = file_storage.tell()
    file_storage.seek(0)  # reset for later reads (e.g. R2 upload)
    return size


def _profile_photo_key(user_id, ext):
    """
    Unlike Cloudinary's /v<timestamp>/ URLs, R2 public URLs don't
    auto-version - reusing the same key on every update would let
    browsers/CDNs keep serving the old cached image. A timestamp suffix
    forces a fresh URL on every upload.
    """
    return f"solar_profiles/{sanitize_path_segment(str(user_id))}_{int(time.time())}.{ext}"


@profile_bp.route('/me', methods=['GET'])
@jwt_required()
def get_profile():
    try:
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        if not user:
            return jsonify({"msg": "User not found"}), 404
        return jsonify(user.to_dict()), 200
    except Exception as e:
        return jsonify({"msg": f"Failed to load profile: {str(e)}"}), 500


@profile_bp.route('/me', methods=['PUT'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({"msg": "User not found"}), 404

    try:
        # Check if request contains multipart form-data (file upload)
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
            if 'full_name' in data:
                user.full_name = data['full_name']
            if 'phone_number' in data:
                user.phone_number = data['phone_number']

            if 'profile_photo' in request.files:
                file_to_upload = request.files['profile_photo']
                if file_to_upload.filename != '':

                    # --- Server-side size validation (defense in depth) ---
                    file_size = _get_file_size(file_to_upload)
                    if file_size > MAX_UPLOAD_SIZE:
                        return jsonify({
                            "success": False,
                            "message": f"Profile photo is too large ({file_size / 1024 / 1024:.1f}MB). Maximum is 5MB."
                        }), 400

                    # --- Basic content-type validation ---
                    if not (file_to_upload.mimetype or '').startswith('image/'):
                        return jsonify({
                            "success": False,
                            "message": "Uploaded file must be an image."
                        }), 400

                    ext = file_to_upload.filename.rsplit('.', 1)[-1] if '.' in file_to_upload.filename else 'jpg'
                    object_key = _profile_photo_key(user.id, ext)

                    try:
                        new_url = upload_to_r2(file_to_upload, object_key, content_type=file_to_upload.mimetype)
                    except Exception as upload_err:
                        return jsonify({
                            "success": False,
                            "message": f"Profile photo upload failed: {str(upload_err)}"
                        }), 502

                    # Delete the old profile photo from R2 if it exists, only
                    # after the new one is confirmed uploaded.
                    old_photo = user.profile_photo
                    user.profile_photo = new_url
                    if old_photo:
                        delete_r2_file(old_photo)
        else:
            # Fallback for JSON requests (e.g. text updates or direct image URLs)
            data = request.get_json() or {}
            if 'full_name' in data:
                user.full_name = data['full_name']
            if 'phone_number' in data:
                user.phone_number = data['phone_number']

            if 'profile_photo' in data and data['profile_photo'] != user.profile_photo:
                profile_photo = data['profile_photo']
                if profile_photo.startswith('http'):
                    old_photo = user.profile_photo
                    user.profile_photo = profile_photo
                    if old_photo:
                        delete_r2_file(old_photo)
                else:
                    # Upload base64 data passed through JSON (e.g. "data:image/png;base64,....")
                    try:
                        if ',' in profile_photo:
                            header, b64data = profile_photo.split(',', 1)
                        else:
                            header, b64data = '', profile_photo
                        mimetype = 'image/png'
                        if 'image/' in header:
                            mimetype = header.split(';')[0].replace('data:', '')
                        ext = mimetype.split('/')[-1] or 'png'
                        file_bytes = base64.b64decode(b64data)
                    except Exception:
                        return jsonify({
                            "success": False,
                            "message": "Invalid base64 image data."
                        }), 400

                    if len(file_bytes) > MAX_UPLOAD_SIZE:
                        return jsonify({
                            "success": False,
                            "message": f"Profile photo is too large ({len(file_bytes) / 1024 / 1024:.1f}MB). Maximum is 5MB."
                        }), 400

                    object_key = _profile_photo_key(user.id, ext)
                    try:
                        new_url = upload_to_r2(io.BytesIO(file_bytes), object_key, content_type=mimetype)
                    except Exception as upload_err:
                        return jsonify({
                            "success": False,
                            "message": f"Profile photo upload failed: {str(upload_err)}"
                        }), 502

                    old_photo = user.profile_photo
                    user.profile_photo = new_url
                    if old_photo:
                        delete_r2_file(old_photo)

        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Profile updated successfully!",
            "data": user.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": f"Update failed: {str(e)}"
        }), 500