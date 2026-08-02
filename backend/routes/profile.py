from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User
import re
import cloudinary
import cloudinary.uploader

profile_bp = Blueprint('profile', __name__)

MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB - keep well under Cloudinary's 10MB cap


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


def _get_file_size(file_storage):
    """Return size in bytes of a Werkzeug FileStorage without consuming the stream."""
    file_storage.seek(0, 2)  # seek to end
    size = file_storage.tell()
    file_storage.seek(0)  # reset for later reads (e.g. cloudinary upload)
    return size


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

                    try:
                        upload_result = cloudinary.uploader.upload(file_to_upload, folder="solar_profiles")
                    except Exception as upload_err:
                        return jsonify({
                            "success": False,
                            "message": f"Profile photo upload failed: {str(upload_err)}"
                        }), 502

                    # Delete the old profile photo from Cloudinary if it exists
                    if user.profile_photo:
                        delete_cloudinary_image(user.profile_photo)

                    user.profile_photo = upload_result.get('secure_url')
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
                    if user.profile_photo:
                        delete_cloudinary_image(user.profile_photo)
                    user.profile_photo = profile_photo
                else:
                    # Upload base64 or string data if passed through JSON
                    upload_result = cloudinary.uploader.upload(profile_photo, folder="solar_profiles")
                    if user.profile_photo:
                        delete_cloudinary_image(user.profile_photo)
                    user.profile_photo = upload_result.get('secure_url')

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