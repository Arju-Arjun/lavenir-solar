from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, User, SupplementDocument, CustomerAuditLog
from utils import check_permission, upload_to_r2, delete_r2_file, sanitize_path_segment
from datetime import datetime
import json

supplements_bp = Blueprint('supplements_bp', __name__)
MODULE_NAME = 'Supplement Documents'
FOLDER_PATH = 'lavenir/supplements'

@supplements_bp.route('/', methods=['GET'])
@jwt_required()
def get_supplements():
    try:
        documents = SupplementDocument.query.order_by(SupplementDocument.created_at.desc()).all()
        return jsonify({"files": [doc.to_dict() for doc in documents]}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to fetch documents: {str(e)}"}), 500


@supplements_bp.route('/', methods=['POST'])
@jwt_required()
def save_or_update_supplements():
    try:
        uid = get_jwt_identity()
        user = User.query.get(uid)
        is_admin = user and user.role and user.role.strip().lower() == 'admin'
        if not is_admin and not check_permission(uid, 'update', MODULE_NAME):
            return jsonify({"error": "Unauthorized permission clearance."}), 403

        documents_data = request.form.get('documents')
        if documents_data:
            try:
                parsed_docs = json.loads(documents_data)
                existing_ids = [doc.get('id') for doc in parsed_docs if 'id' in doc]
                
                
                all_docs = SupplementDocument.query.all()
                for db_doc in all_docs:
                    if db_doc.id not in existing_ids:
                        if db_doc.file_url:
                            delete_r2_file(db_doc.file_url)
                        db.session.delete(db_doc)
                    else:
                       
                        matching = next((d for d in parsed_docs if d.get('id') == db_doc.id), None)
                        if matching:
                            db_doc.title = matching.get('name', db_doc.title)
                            db_doc.description = matching.get('description', db_doc.description)
            except Exception as json_err:
                return jsonify({"error": f"Invalid documents payload: {str(json_err)}"}), 400

        
        new_file = request.files.get('new_file')
        if new_file and new_file.filename != '':
            title = request.form.get('title', 'Untitled Document')
            description = request.form.get('description', '')
            
            ext = new_file.filename.rsplit('.', 1)[-1] if '.' in new_file.filename else 'pdf'
            safe_title = sanitize_path_segment(title)
            object_key = f"{FOLDER_PATH}/{safe_title}_{int(datetime.utcnow().timestamp())}.{ext}"
            
            try:
                file_url = upload_to_r2(new_file, object_key, content_type=new_file.mimetype)
            except Exception as upload_err:
                return jsonify({"error": f"Cloud storage upload failed: {str(upload_err)}"}), 502
            
            new_doc = SupplementDocument(
                title=title,
                description=description,
                file_url=file_url
            )
            db.session.add(new_doc)

        
        audit = CustomerAuditLog(
            customer_project_id=1,  
            user_id=uid,
            action="UPDATE",
            module_name=MODULE_NAME,
            changes_payload=json.dumps({"status": "Supplement documents updated successfully"})
        )
        db.session.add(audit)

        db.session.commit()
        
        
        updated_docs = SupplementDocument.query.order_by(SupplementDocument.created_at.desc()).all()
        return jsonify({"message": "Documents saved successfully", "files": [d.to_dict() for d in updated_docs]}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Server error: {str(e)}"}), 500