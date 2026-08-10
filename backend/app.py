import os
import logging
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from datetime import timedelta

from models import db

from routes.auth import auth_bp
from routes.customers import customers_bp
from routes.site_visit import site_visit_bp
from routes.staff import staff_bp
from routes.permissions import permissions_bp
from routes.mnre_profile import mnre_bp
from routes.payment import payment_bp
from routes.bank_loan import bank_loan_bp
from routes.kseb import kseb_bp
from routes.kseb_registration import kseb_reg_bp
from routes.mnre_installation import mnre_installation_bp
from routes.dcr import dcr_bp
from routes.service import service_bp
from routes.material import material_bp
from routes.material_installation import installation_bp
from routes.material_item import material_item_bp
from routes.push import push_bp
from routes.notifications import notifications_bp
from routes.dashboard import admin_dashboard_bp, staff_dashboard_bp
from routes.documents import documents_bp
from routes.profile import profile_bp
from routes.workflow import workflow_bp
from routes.complaints import complaints_bp
from routes.reports import reports_bp
from routes.backup import backup_bp
from routes.supplements import supplements_bp
from routes.scheduler import start_scheduler

load_dotenv()

# Without this, logger.info(...) calls (used on success by backup/runner.py
# and elsewhere) print nothing by default - only logger.warning/error/
# exception would surface. This makes success AND failure visible.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = Flask(__name__)

CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:4173", "http://127.0.0.1:4173",
            "https://lavenir-solar.vercel.app",
        ],
        "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],  # added PATCH
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True,
    }
})

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# pool_pre_ping + recycle avoid stale-connection / SSL EOF errors on Render
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "fallback_secret_key")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=30)
jwt = JWTManager(app)

db.init_app(app)

with app.app_context():
    db.create_all()

# NOTE: runs once per process. If deployed with >1 gunicorn/uwsgi worker,
# set SCHEDULER_ENABLED=false (see scheduler.py) on all but one worker, or
# the scheduler fires duplicate notification checks per tick.
start_scheduler(app)

app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(customers_bp, url_prefix='/api/customers')
app.register_blueprint(site_visit_bp, url_prefix='/api/site-visit')
app.register_blueprint(staff_bp, url_prefix='/api/staff')
app.register_blueprint(permissions_bp, url_prefix='/api/staff/permissions')
app.register_blueprint(mnre_bp, url_prefix='/api/mnre-profile')
app.register_blueprint(payment_bp, url_prefix='/api/payment')
app.register_blueprint(bank_loan_bp, url_prefix='/api/bank-loan')
app.register_blueprint(kseb_bp, url_prefix='/api/kseb')
app.register_blueprint(kseb_reg_bp, url_prefix='/api/kseb-registration')
app.register_blueprint(mnre_installation_bp, url_prefix='/api/mnre-installation')
app.register_blueprint(dcr_bp, url_prefix='/api/dcr')
app.register_blueprint(service_bp, url_prefix='/api/service')
app.register_blueprint(material_bp, url_prefix='/api/material')
app.register_blueprint(installation_bp, url_prefix='/api/installation')
app.register_blueprint(material_item_bp, url_prefix='/api/material_item')
app.register_blueprint(push_bp, url_prefix='/api/push')
app.register_blueprint(notifications_bp, url_prefix='/api/notifications')
app.register_blueprint(admin_dashboard_bp, url_prefix='/api/admin/dashboard')
app.register_blueprint(staff_dashboard_bp, url_prefix='/api/staff/dashboard')
app.register_blueprint(documents_bp, url_prefix='/api/documents')
app.register_blueprint(profile_bp, url_prefix='/api/profile')
app.register_blueprint(workflow_bp, url_prefix='/api/workflow')
app.register_blueprint(complaints_bp, url_prefix='/api/complaints')
app.register_blueprint(reports_bp, url_prefix='/api/reports')
app.register_blueprint(backup_bp, url_prefix='/api/backup')
app.register_blueprint(supplements_bp, url_prefix='/api/supplements')

@app.route('/')
def health_check():
    return jsonify({
        "status": "online",
        "message": "Lavenir Solar Backend API is running successfully!"
    }), 200


if __name__ == '__main__':
    app.run(debug=True, port=5000, use_reloader=False)