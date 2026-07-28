import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import { FaLock, FaTimes, FaPhone, FaWhatsapp } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';

const C_Profile = () => {
  const getCustomerIdFromURL = () => {
    const segments = window.location.pathname.split('/');
    return segments[segments.length - 1] || '';
  };

  const customerId = getCustomerIdFromURL();

  const customNavigateTo = (path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('popstate'));
  };

  const Districts = [
    "Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod",
    "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad",
    "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"
  ];

  const { role, permissions, isAdmin } = useAuth();

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState(''); 
  const [actionLoading, setActionLoading] = useState(false);

  // State and ref for phone popup modal & click-outside handling
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const phoneModalRef = useRef(null);

  const [requestStatus, setRequestStatus] = useState({ view: null, update: null, delete: null });
  const [requestLoading, setRequestLoading] = useState(false);

  const [formData, setFormData] = useState({
    customer_name: '',
    phone_number: '',
    district: '',
    place: '',
    email: '',
    capacity_kw: '0.00'
  });

  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg');

  const modulePermissions = permissions?.["Customer Profile"] || { view: true, update: false, delete: false };
  const canView = isAdmin || role === 'admin' || modulePermissions.view;
  const canUpdate = isAdmin || role === 'admin' || modulePermissions.update;
  const canDelete = isAdmin || role === 'admin' || modulePermissions.delete;

  useEffect(() => {
    if (customerId) {
      fetchCustomerProfile();
      fetchAccessRequests();
    }
  }, [customerId]);

  // Click outside listener for phone modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (phoneModalRef.current && !phoneModalRef.current.contains(event.target)) {
        setShowPhoneModal(false);
      }
    };

    if (showPhoneModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPhoneModal]);

  const fetchCustomerProfile = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/${customerId}`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }
      if (response.ok) {
        const jsonResponse = await response.json();
        const data = jsonResponse.data || jsonResponse;
        
        setCustomer(data);
        setFormData({
          customer_name: data.customer_name || '',
          phone_number: data.phone_number || '',
          district: data.district || '',
          place: data.place || '',
          email: data.email || '',
          capacity_kw: data.capacity_kw || '0.00'
        });
        if (data.profile_photo) {
          setImagePreview(data.profile_photo);
        }
      } else {
        setError('Failed to retrieve customer profile details.');
      }
    } catch (err) {
      console.error('Profile fetch fault:', err);
      setError('A network error occurred while loading profile data.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/${customerId}/permissions`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.requests) {
          setRequestStatus(data.requests);
        }
      }
    } catch (err) {
      console.error('Failed to fetch permission requests:', err);
    }
  };

  const handleRequestAccess = async (tier) => {
    setRequestLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/${customerId}/request-access`, {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ requested_tier: tier })
      });
      if (res.ok) {
        setRequestStatus(prev => ({ ...prev, [tier]: 'Pending' }));
        alert(`Access request for '${tier}' submitted successfully to the administrator.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.message || errData.error || 'Failed to submit access request.');
      }
    } catch (err) {
      console.error('Request access fault:', err);
      alert('A network error occurred while submitting the request.');
    } finally {
      setRequestLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfilePhotoFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleOpenModal = (type) => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleModalConfirm = async () => {
    setActionLoading(true);
    try {
      if (modalType === 'edit') {
        const payload = new FormData();
        Object.keys(formData).forEach((key) => {
          payload.append(key, formData[key]);
        });
        if (profilePhotoFile) {
          payload.append('profile_photo', profilePhotoFile);
        }

        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/${customerId}`, {
          method: 'PUT',
          headers: { "Authorization": `Bearer ${localStorage.getItem('token')}` },
          body: payload
        });

        if (res.ok) {
          setIsEditing(false);
          setProfilePhotoFile(null);
          await fetchCustomerProfile();
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.message || 'Failed to update customer profile records.');
        }
      } else if (modalType === 'delete') {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/${customerId}`, {
          method: 'DELETE',
          headers: { "Authorization": `Bearer ${localStorage.getItem('token')}` }
        });
        if (res.ok) {
          customNavigateTo('/customers');
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.message || 'Failed to delete customer account.');
        }
      }
    } catch (err) {
      console.error('Action fault:', err);
      alert('A network error occurred during the transaction.');
    } finally {
      setActionLoading(false);
      setIsModalOpen(false);
    }
  };

  const handleCancelEditMode = () => {
    setIsEditing(false);
    if (customer) {
      setFormData({
        customer_name: customer.customer_name || '',
        phone_number: customer.phone_number || '',
        district: customer.district || '',
        place: customer.place || '',
        email: customer.email || '',
        capacity_kw: customer.capacity_kw || '0.00'
      });
      if (customer.profile_photo) {
        setImagePreview(customer.profile_photo);
      }
    }
    setProfilePhotoFile(null);
  };

  if (loading) {
    return (
      <div className="table-loader-container">
        <div className="table-spinner"></div>
        <p>Loading Customer Profile...</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted </h3>
          <p>You don't have permission to access the customer profile workspace.</p>
          {requestStatus.view === 'Pending' ? (
            <div className="sitevisit-alert-success-banner">⚠️ View Request Pending Approval</div>
          ) : (
            <button
              type="button"
              className="request-access-trigger-btn"
              onClick={() => handleRequestAccess("view")}
              disabled={requestLoading || requestStatus.view === 'Pending'}
            >
              Request View Access
            </button>
          )}
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return <div className="error-message-alert">{error || 'Customer record missing.'}</div>;
  }

  return (
    <div className="customer-profile-root-container">
      <div className="site-details-deck">
        <div className="customer-profile-header-bar">
          <h2 className="workspace-pane-title" style={{ margin: 0 }}>Customer Profile</h2>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleOpenModal('edit'); }}>
          <div className="c-profile-adaptive-card">
            <div className="c-profile-avatar-section">
              <img src={imagePreview} alt="Customer Profile" className="c-profile-avatar-img" />
              {isEditing && canUpdate && (
                <div style={{ marginTop: '10px' }}>
                  <label htmlFor="profile-photo-upload" className="vault-doc-badge" style={{ cursor: 'pointer', display: 'inline-block' }}>
                    Change Photo
                  </label>
                  <input id="profile-photo-upload" type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
                </div>
              )}
            </div>

            <div className="c-profile-fields-grid">
              <div className="detail-item-node">
                <span className="node-label">Customer Name:</span>
                {isEditing && canUpdate ? (
                  <input type="text" name="customer_name" value={formData.customer_name} onChange={handleInputChange} className="control-input-field" required />
                ) : (
                  <span className="node-value">{customer.customer_name || '—'}</span>
                )}
              </div>

              <div className="detail-item-node">
                <span className="node-label">Email Address:</span>
                {isEditing && canUpdate ? (
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} className="control-input-field" />
                ) : (
                  <span className="node-value">{customer.email || '—'}</span>
                )}
              </div>

              <div className="detail-item-node">
                <span className="node-label">Phone Number:</span>
                {isEditing && canUpdate ? (
                  <input type="text" name="phone_number" value={formData.phone_number} onChange={handleInputChange} className="control-input-field" required />
                ) : (
                  <span className="node-value">
                    {customer.phone_number ? (
                      <>
                        <button
                          type="button"
                          className="clickable-phone-trigger"
                          onClick={() => setShowPhoneModal(true)}
                        >
                          {customer.phone_number}
                        </button>

                        {/* Phone Quick Options Modal rendered via Portal to escape parent container constraints */}
                        {showPhoneModal && ReactDOM.createPortal(
                          <div className="phone-modal-backdrop-root">
                            <div className="phone-modal-card" ref={phoneModalRef}>
                              <button 
                                type="button" 
                                className="phone-modal-close-btn" 
                                onClick={() => setShowPhoneModal(false)}
                              >
                                <FaTimes />
                              </button>
                              
                              <h3 className="phone-modal-title">Select Action</h3>

                              <div className="phone-modal-options-list">
                                <a
                                  href={`tel:${customer.phone_number}`}
                                  className="phone-modal-option-item call-action"
                                  onClick={() => setShowPhoneModal(false)}
                                >
                                  <span className="phone-modal-icon-wrapper call-bg">
                                    <FaPhone />
                                  </span>
                                  <div className="phone-modal-text-group">
                                    <span className="action-label">Call Customer</span>
                                    <span className="action-number">{customer.phone_number}</span>
                                  </div>
                                </a>

                                <a
                                  href={`https://wa.me/${customer.phone_number.replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="phone-modal-option-item whatsapp-action"
                                  onClick={() => setShowPhoneModal(false)}
                                >
                                  <span className="phone-modal-icon-wrapper whatsapp-bg">
                                    <FaWhatsapp />
                                  </span>
                                  <div className="phone-modal-text-group">
                                    <span className="action-label">Open WhatsApp</span>
                                    <span className="action-number">{customer.phone_number}</span>
                                  </div>
                                </a>
                              </div>
                            </div>
                          </div>,
                          document.body
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                )}
              </div>

              <div className="detail-item-node">
                <span className="node-label">District:</span>
                {isEditing && canUpdate ? (
                  <>
                    <input type="text" name="district" value={formData.district} onChange={handleInputChange} className="control-input-field" list="district-options" required />
                    <datalist id="district-options">
                      {Districts.map((district) => (
                        <option key={district} value={district} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <span className="node-value">{customer.district || '—'}</span>
                )}
              </div>

              <div className="detail-item-node">
                <span className="node-label">Place / Location:</span>
                {isEditing && canUpdate ? (
                  <input type="text" name="place" value={formData.place} onChange={handleInputChange} className="control-input-field"  />
                ) : (
                  <span className="node-value">{customer.place || '—'}</span>
                )}
              </div>

              <div className="detail-item-node">
                <span className="node-label">System Capacity (KW):</span>
                {isEditing && canUpdate ? (
                  <input type="number" step="0.01" name="capacity_kw" value={formData.capacity_kw} onChange={handleInputChange} className="control-input-field" required onWheel={(e) => e.target.blur()} />
                ) : (
                  <span className="node-value text-emerald">{customer.capacity_kw || '0.00'} KW</span>
                )}
              </div>
            </div>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row element-gap-mid" style={{ marginTop: '20px', flexWrap: 'wrap' }}>
            {!isEditing && (
              <>
                {canUpdate ? (
                  <button type="button" className="btn-action-edit" onClick={() => setIsEditing(true)}>
                    Edit Profile
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="btn-action-edit" 
                    onClick={() => handleRequestAccess('update')}
                    disabled={requestLoading || requestStatus.update === 'Pending'}
                    style={{ backgroundColor: requestStatus.update === 'Pending' ? '#ca8a04' : undefined }}
                  >
                    {requestStatus.update === 'Pending' ? 'Update Request Pending...' : 'Request Update Authorization'}
                  </button>
                )}

                {canDelete ? (
                  <button type="button" className="btn-action-delete" onClick={() => handleOpenModal('delete')}>
                    Delete Account
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="btn-action-delete" 
                    onClick={() => handleRequestAccess('delete')}
                    disabled={requestLoading || requestStatus.delete === 'Pending'}
                    style={{ opacity: requestStatus.delete === 'Pending' ? 0.7 : 1 }}
                  >
                    {requestStatus.delete === 'Pending' ? 'Delete Request Pending...' : 'Request Delete Authorization'}
                  </button>
                )}
              </>
            )}

            {isEditing && canUpdate && (
              <>
                <button type="submit" className="btn-action-edit">Save Updates</button>
                <button type="button" className="btn-action-cancel" onClick={handleCancelEditMode}>Cancel</button>
              </>
            )}
          </div>
        </form>
      </div>

      <ConfirmationModal 
        isOpen={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onConfirm={handleModalConfirm}
        title={modalType === 'edit' ? "Confirm Profile Update" : "Delete Customer Profile Account"}
        message={modalType === 'edit' 
          ? "Are you sure you want to save these profile changes to the database records?" 
          : `Are you completely sure you want to permanently delete the profile account data for ${customer?.customer_name}? This action automatically purges all connected storage media permanently.`
        }
        confirmLabel={modalType === 'edit' ? "Save Changes" : "Delete Permanently"}
        isLoading={actionLoading}
      />
    </div>
  );
};

export default C_Profile;