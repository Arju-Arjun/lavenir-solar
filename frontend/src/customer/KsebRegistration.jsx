import React, { useEffect, useState, useMemo } from 'react';
import { FaLock, FaPaperPlane, FaSave, FaEdit, FaCheckCircle, FaExclamationCircle } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';

const initialForm = {
  registration_submitted: false,
  registration_date: '',
  completion_submitted: false,
  completion_date: '',
  agreement_submitted: false,
  agreement_date: '',
  payment_done: false,
  payment_date: '',
  plant_energized: false,
  plant_energized_date: '',
  wifi_configured: false,
  wifi_configured_date: '',
  comments: '',
};

export default function KsebRegistration({ customerId }) {
  const { permissions, refetchPermissions, isAdmin, role } = useAuth();
  
  // Must match MODULE_NAME in kseb_registration.py exactly — this is the key
  // the backend actually writes into permissions_matrix on approval.
  const moduleAccess = useMemo(
    () => permissions["KSEB Registration & Completion"] || { view: false, create: false, update: false, delete: false },
    [permissions]
  );
  const canView = isAdmin || role === 'admin' || moduleAccess.view;
  const canUpdate = isAdmin || role === 'admin' || moduleAccess.update;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState({});
  const [requestLoading, setRequestLoading] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [wifi, setWifi] = useState(null); 
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    if (customerId) {
      fetchAccessRequests();
    }
  }, [customerId]);

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb-registration/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchRegistrationData(); // manages its own loading state
        } else {
          setAccessDenied(true);
          setLoading(false);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
      } else {
        // Any other failure shouldn't leave the spinner stuck forever.
        setLoading(false);
      }
    } catch (err) {
      console.error('Failed to verify access matrix privileges:', err);
      if (!canView) setAccessDenied(true);
      setLoading(false);
    }
  };

  const fetchRegistrationData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb-registration/${customerId}/`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setWifi(data.wifi_required);
        if (data.registration) {
          setRegistration(data.registration);
          setFormData({
            registration_submitted: !!data.registration.registration_submitted,
            registration_date: data.registration.registration_date ? data.registration.registration_date.substring(0, 10) : '',
            completion_submitted: !!data.registration.completion_submitted,
            completion_date: data.registration.completion_date ? data.registration.completion_date.substring(0, 10) : '',
            agreement_submitted: !!data.registration.agreement_submitted,
            agreement_date: data.registration.agreement_date ? data.registration.agreement_date.substring(0, 10) : '',
            payment_done: !!data.registration.payment_done,
            payment_date: data.registration.payment_date ? data.registration.payment_date.substring(0, 10) : '',
            plant_energized: !!data.registration.plant_energized,
            plant_energized_date: data.registration.plant_energized_date ? data.registration.plant_energized_date.substring(0, 10) : '',
            wifi_configured: !!data.registration.wifi_configured,
            wifi_configured_date: data.registration.wifi_configured_date ? data.registration.wifi_configured_date.substring(0, 10) : '',
            comments: data.registration.comments || '',
          });
        } else {
          setRegistration(null);
          setFormData(initialForm);
        }
      }
    } catch (error) {
      console.error('Failed to fetch KSEB registration details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb-registration/request-access/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ permission_type: permissionType })
      });
      if (response.ok) {
        const res = await response.json();
        setPendingRequests((prev) => ({
          ...prev,
          [permissionType]: "Pending"
        }));
        alert(res.message);
        if (refetchPermissions) {
          await refetchPermissions();
        }
      }
    } catch (err) {
      console.error("Transmission error on permission pipeline", err);
    } finally {
      setRequestLoading(false);
    }
  };

  const dateFieldByCheckbox = {
    registration_submitted: 'registration_date',
    completion_submitted: 'completion_date',
    agreement_submitted: 'agreement_date',
    payment_done: 'payment_date',
    plant_energized: 'plant_energized_date',
    wifi_configured: 'wifi_configured_date',
  };

    const handleInputChange = (e) => {
        if (!canUpdate) return;
        const { name, value, type, checked } = e.target;
        setFormData(prev => {
          const next = { ...prev, [name]: type === 'checkbox' ? checked : value };
          if (type === 'checkbox' && !checked && dateFieldByCheckbox[name]) {
            next[dateFieldByCheckbox[name]] = '';
          }
          
        
          if (name === 'registration_submitted' && !checked) {
            next.payment_done = false;
            next.payment_date = '';
          }
          
          return next;
        });
      };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required write permissions.");
      return;
    }
    
    setLoading(true);
    const formPayload = new URLSearchParams();
    Object.keys(formData).forEach(key => {
      formPayload.append(key, formData[key]);
    });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb-registration/${customerId}/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formPayload.toString()
      });

      if (response.ok) {
        setIsEditing(false);
        fetchRegistrationData();
      } else {
        alert('Failed to save KSEB registration data.');
      }
    } catch (error) {
      console.error('Error saving registration details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the KSEB Registration workspace.</p>
          {pendingRequests["view"] === "Pending" ? (
            <div className="sitevisit-alert-success-banner">⚠️ View Request Pending Approval</div>
          ) : (
            <button
              type="button"
              className="request-access-trigger-btn"
              onClick={() => handleRequestAccessSubmit("view")}
              disabled={requestLoading || pendingRequests["view"] === "Pending"}
            >
              Request View Access
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sitevisit-section">
      {loading && <div className="sitevisit-loading-overlay"><div className="table-spinner"></div>Loading...</div>}

      {!isEditing ? (
        <div className="site-details-deck">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "15px" }}>
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>KSEB Registration & Completion</h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {registration && !canUpdate && (
                pendingRequests["update"] === "Pending" ? (
                  <span style={{ fontSize: "0.8rem", color: "#ca8a04", fontWeight: "600" }}>⚠️ Update Request Pending</span>
                ) : (
                  <button type="button" onClick={() => handleRequestAccessSubmit("update")} disabled={requestLoading} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", padding: "4px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", color: "#475569" }}>
                    <FaPaperPlane size={10} /> Request Update Authorization
                  </button>
                )
              )}
            </div>
          </div>
          


          <div className="detail-data-grid">
            <div className="detail-item-node">
              <span className="node-label">Registration Submitted:</span>
              <span  className={`status-badge-token-mnre ${registration?.registration_submitted ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {registration?.registration_submitted ? 'Yes' : 'No'}
              </span>
              {registration?.registration_date && (
                <span className="payment-flow-date-badge">
                  ({new Date(registration.registration_date).toLocaleDateString('en-GB').split('/').join('-')})
                </span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Completion Submitted:</span>
              <span className={`status-badge-token-mnre ${registration?.completion_submitted ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {registration?.completion_submitted ? 'Yes' : 'No'}
              </span>
              <span className="payment-flow-date-badge">
                {registration?.completion_date ? `(${new Date(registration.completion_date).toLocaleDateString('en-GB').split('/').join('-')})` : ''}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Agreement Submitted:</span>
              <span className={`status-badge-token-mnre ${registration?.agreement_submitted ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {registration?.agreement_submitted ? 'Yes' : 'No'}
              </span>
              {registration?.agreement_date && (
                <span className="payment-flow-date-badge">
                  ({new Date(registration.agreement_date).toLocaleDateString('en-GB').split('/').join('-')})
                </span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Payment Done:</span>
              <span className={`status-badge-token-mnre ${registration?.payment_done ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {registration?.payment_done ? 'Yes' : 'No'}
              </span>
              {registration?.payment_date && (
                <span className="payment-flow-date-badge">
                  ({new Date(registration.payment_date).toLocaleDateString('en-GB').split('/').join('-')})
                </span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Plant Energized:</span>
              <span className={`status-badge-token-mnre ${registration?.plant_energized ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {registration?.plant_energized ? 'Yes' : 'No'}
              </span>
              {registration?.plant_energized_date && (
                <span className="payment-flow-date-badge">
                  ({new Date(registration.plant_energized_date).toLocaleDateString('en-GB').split('/').join('-')})
                </span>
              )}
            </div>
            {(wifi === 'Yes' || wifi === true) && (
              <div className="detail-item-node">
                <span className="node-label">WiFi Configured:</span>
                <span className={`status-badge-token-mnre ${registration?.wifi_configured ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                  {registration?.wifi_configured ? 'Yes' : 'No'}
                </span>
                {registration?.wifi_configured_date && (
                  <span className="payment-flow-date-badge">
                    ({new Date(registration.wifi_configured_date).toLocaleDateString('en-GB').split('/').join('-')})
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="text-narrative-block" style={{ marginTop: "15px" }}>
            <label className="narrative-label">Comments</label>
            <p className="comments-text-display">{registration?.comments || "No comments entered."}</p>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && (
              <button type="button" className="btn-action-edit" onClick={() => setIsEditing(true)}>
                <FaEdit />Edit Details
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="interactive-form-workspace">
          <h2 className="workspace-pane-title" style={{ marginBottom: "30px" }}>
            Edit KSEB Registration & Completion
          </h2>

          <div className="form-grid-layout">
            {/* Registration Submitted & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input 
                    type="checkbox" 
                    name="registration_submitted" 
                    checked={formData.registration_submitted} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Registration Submitted</span>
                </label>
              </div>
              {formData.registration_submitted && (
                <div className="form-group-element">
                  <label>Registration Date</label>
                  <input 
                    type="date" 
                    name="registration_date" 
                    value={formData.registration_date} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="control-input-field" 
                  />
                </div>
              )}
            </div>

            {/* Completion Submitted & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input 
                    type="checkbox" 
                    name="completion_submitted" 
                    checked={formData.completion_submitted} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Completion Submitted</span>
                </label>
              </div>
              {formData.completion_submitted && (
                <div className="form-group-element">
                  <label>Completion Date</label>
                  <input 
                    type="date" 
                    name="completion_date" 
                    value={formData.completion_date} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="control-input-field" 
                  />
                </div>
              )}
            </div>

            {/* Agreement Submitted & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input 
                    type="checkbox" 
                    name="agreement_submitted" 
                    checked={formData.agreement_submitted} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Agreement Submitted</span>
                </label>
              </div>
              {formData.agreement_submitted && (
                <div className="form-group-element">
                  <label>Agreement Date</label>
                  <input 
                    type="date" 
                    name="agreement_date" 
                    value={formData.agreement_date} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="control-input-field" 
                  />
                </div>
              )}
            </div>

            {/* Payment Done & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label 
                  className="kseb-checkbox-custom-label"
                  style={!formData.registration_submitted ? { color: "#9ca3af", cursor: "not-allowed" } : {}}
                >
                  <input 
                    type="checkbox" 
                    name="payment_done" 
                    checked={formData.payment_done} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate || !formData.registration_submitted} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Payment Done</span>
                </label>
                {!formData.registration_submitted && (
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "4px", display: "block" }}>
                    Complete registration to enable payment
                  </span>
                )}
              </div>
              {formData.payment_done && (
                <div className="form-group-element">
                  <label>Payment Date</label>
                  <input 
                    type="date" 
                    name="payment_date" 
                    value={formData.payment_date} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="control-input-field" 
                  />
                </div>
              )}
            </div>

            {/* Plant Energized & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input 
                    type="checkbox" 
                    name="plant_energized" 
                    checked={formData.plant_energized} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Plant Energized</span>
                </label>
              </div>
              {formData.plant_energized && (
                <div className="form-group-element">
                  <label>Plant Energized Date</label>
                  <input 
                    type="date" 
                    name="plant_energized_date" 
                    value={formData.plant_energized_date} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="control-input-field" 
                  />
                </div>
              )}
            </div>

            {/* WiFi Configuration & Date */}
            {(wifi === 'Yes' || wifi === true) && (
              <div className="checkbox-date-row-group">
                <div className="form-group-element">
                  <label className="kseb-checkbox-custom-label">
                    <input 
                      type="checkbox" 
                      name="wifi_configured" 
                      checked={formData.wifi_configured} 
                      onChange={handleInputChange} 
                      disabled={!canUpdate} 
                      className="kseb-custom-checkbox" 
                    />
                    <span className="kseb-label-text">WiFi Configuration</span>
                  </label>
                </div>
                {formData.wifi_configured && (
                  <div className="form-group-element">
                    <label>WiFi Configured Date</label>
                    <input 
                      type="date" 
                      name="wifi_configured_date" 
                      value={formData.wifi_configured_date} 
                      onChange={handleInputChange} 
                      disabled={!canUpdate} 
                      className="control-input-field" 
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
            <label>Comments</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!canUpdate} rows="3" />
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
            <button type="button" className="btn-action-cancel" onClick={() => setIsEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}