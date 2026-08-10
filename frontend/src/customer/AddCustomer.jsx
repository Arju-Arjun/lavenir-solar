import React, { useState, useRef } from 'react';

export default function AddCustomer({ onCancel, onSuccess }) {
  // Initialize form state matching the database layer validation requirements
  const initialFormState = {
    customer_name: '',
    email: '',
    phone_number: '',
    district: '',
    place: '',
    capacity_kw: '0.00'
  };

  const Districts = [
    "Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod",
    "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad",
    "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad","other"
  ];

  const [formData, setFormData] = useState(initialFormState);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [imagePreview, setImagePreview] = useState('https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  // Sync keyboard inputs directly with state parameters
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Process image picker selections and generate a local UI preview URL
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfilePhoto(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // Form Reset Trigger: Restores default parameters cleanly
  const handleResetForm = () => {
    setFormData(initialFormState);
    setProfilePhoto(null);
    setImagePreview('https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Form Submission Handler: Dispatches data bundle via multipart/form-data
  const handleSubmitForm = async (e) => {
    e.preventDefault();

    // Field Validation Guardrail
    if (!formData.customer_name || !formData.phone_number || !formData.district) {
      alert('Required parameters missing! Name, Phone, District, and Place must be populated.');
    } else if (formData.phone_number.length !== 10 || !/^\d+$/.test(formData.phone_number)) {
      alert('Phone number must be exactly 10 digits and numeric only.');
    }
    else if (formData.capacity_kw && parseFloat(formData.capacity_kw) <= 1) {
      alert('Capacity (kW) minimum 1kw.');
      return;
    }

    setIsSubmitting(true);
    const dataPayload = new FormData();

    // Append standard fields
    Object.keys(formData).forEach((key) => {
      dataPayload.append(key, formData[key]);
    });

    // Append profile photo if customized by worker
    if (profilePhoto) {
      dataPayload.append('profile_photo', profilePhoto);
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '' // Secure JWT Auth handshake
        },
        body: dataPayload // Browser automatically sets Content-Type to multipart/form-data with boundary strings
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Server encountered an operational error parsing metadata.');
      }

    
      
      if (onSuccess) {
        onSuccess();
      } else if (onCancel) {
        onCancel(); // Fallback back to directory screen
      }
    } catch (err) {
      alert(`Onboarding Action Failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="customers-view-container">
      {/* Reusable Header Layout Box matching system workspace look and feel */}
      <div className="profile-header-summary-card">
        <div>
          <h2>New Customer Registration</h2>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>
            Enter client details, assign service locations, and set up initial power capacities.
          </p>
        </div>
        {/* <button className="btn-action-cancel" onClick={onCancel} disabled={isSubmitting}>
          ↩ Back
        </button> */}
      </div>

      <div className="table-responsive-wrapper" style={{ padding: '24px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '16px' }}>
        <form onSubmit={handleSubmitForm} autoComplete="off" className="directory-management-form-layout">
          
          {/* Section A: Profile Image Customization Zone */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
              <img 
                src={imagePreview} 
                alt="Profile Preview" 
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', border: '3px solid #cbd5e1' }}
              />
              {profilePhoto && (
                <button 
                  type="button" 
                  style={{ position: 'absolute', top: 0, right: 0, backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                  onClick={() => {
                    setProfilePhoto(null);
                    setImagePreview('https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  ✖
                </button>
              )}
            </div>
            <label style={{ padding: '6px 16px', border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: '#f8fafc', fontSize: '0.875rem', fontWeight: '500', cursor: 'pointer', color: '#475569' }}>
              📷 Upload Project Photo
              <input 
                type="file" 
                ref={fileInputRef}
                accept="image/*" 
                style={{ display: 'none' }} 
                onChange={handleFileChange}
              />
            </label>
          </div>

          {/* Section B: General Information Form Fields Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>Customer Full Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input 
                type="text" 
                name="customer_name" 
                className="form-field-input"
                value={formData.customer_name} 
                onChange={handleInputChange}
                required
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>Mobile Number <span style={{ color: '#ef4444' }}>*</span></label>
              <input 
                type="text" 
                name="phone_number" 
                className="form-field-input"
                value={formData.phone_number} 
                onChange={handleInputChange}
                maxLength="10"
                required

              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>Email Address</label>
              <input 
                type="email" 
                name="email" 
                className="form-field-input"
                placeholder="(Optional)"
                value={formData.email} 
                onChange={handleInputChange}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>District <span style={{ color: '#ef4444' }}>*</span></label>
              <select
                name="district"
                className="form-field-input"
                value={formData.district}
                onChange={handleInputChange}
                required
              >
                <option value="">Select district</option>
                {Districts.map((district) => (
                  <option key={district} value={district}>{district}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>Specific Place / Town </label>
              <input 
                type="text" 
                name="place" 
                className="form-field-input"
                value={formData.place} 
                onChange={handleInputChange}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: '6px', color: '#334155' }}>Capacity (kW)</label>
              <input 
                type="number" 
                step="0.5"
                min="0"
                name="capacity_kw" 
                className="form-field-input"
                // value={formData.capacity_kw} 
                onChange={handleInputChange}
                
                required
              />
            </div>

          </div>

          {/* Section C: Split Action Trigger Buttons Bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
            <button 
              type="button" 
              className="btn-action-cancel" 
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="button" 
              style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', cursor: 'pointer', fontWeight: '500' }}
              onClick={handleResetForm}
              disabled={isSubmitting}
            >
              Reset
            </button>
            <button 
              type="submit" 
              className="btn-action-edit"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px' }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="spinner-icon" style={{ borderTopColor: '#d10b0b', width: '14px', height: '14px' }}></div>
                  Saving...
                </>
              ) : (
                'Save Customer'
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}