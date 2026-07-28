import os
import cloudinary
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from models import db
from datetime import timedelta

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

# Background job: twice-daily maintenance/renewal notification checks
from routes.scheduler import start_scheduler


load_dotenv()

app = Flask(__name__)

# FIX: Explicitly allow the Authorization header and cross-origin preflight requests
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5173", "http://127.0.0.1:5173","http://localhost:4173", "http://127.0.0.1:4173","https://lavenir-solar-rho.vercel.app"],  # Match your React dev server port
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True
    }
})


app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "fallback_secret_key")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=30) 
jwt = JWTManager(app)

# Global Cloudinary Configuration Integration
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)

db.init_app(app)

with app.app_context():
    db.create_all()

# Start the background notification scheduler (first/renewal maintenance checks)
start_scheduler(app)

# Register Blueprint Routers
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



@app.route('/')
def health_check():
    return jsonify({
        "status": "online", 
        "message": "Solar ERP Backend API is running successfully!"
    }), 200

if __name__ == '__main__':
    # use_reloader=False: prevents the scheduler from starting twice under
    # the Werkzeug dev-server auto-reloader (which spawns a second process).
    app.run(debug=True, port=5000, use_reloader=False)