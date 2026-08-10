import React, { useState, useEffect, useMemo } from "react";
import { FaLock, FaEdit, FaCheckCircle, FaExclamationCircle, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";

const Kseb = ({ customerId }) => {
  const { role, permissions, refetchPermissions, isAdmin } = useAuth();
  
  const modulePermissions = useMemo(
    () => isAdmin || role === 'admin'
      ? { view: true, create: true, update: true, delete: true }
      : (permissions["KSEB Feasibility"] || permissions["KSEB"] || { view: false, create: false, update: false }),
    [isAdmin, role, permissions]
  );

  const canView = isAdmin || role === 'admin' || modulePermissions.view;
  const canUpdate = isAdmin || role === 'admin' || modulePermissions.update;

  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingRequests, setPendingRequests] = useState({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const [siteVisitFlags, setSiteVisitFlags] = useState({
    ownership_change: false,
    load_enhancement: false
  });

  const [ksebRecord, setKsebRecord] = useState(null);
  const [formData, setFormData] = useState({
    ownership_status: "Pending",
    ownership_comment: "",
    load_enhancement_status: "Pending",
    load_enhancement_comment: "",
    feasibility_status: "Pending",
    comments: "",
    fee_paid: false,
    payment_date: "",
    visiter_name: ""
  });

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  useEffect(() => {
    if (customerId) {
      fetchAccessRequests();
    }
  }, [customerId]);

  const fetchAccessRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          await fetchKsebDataset();
        } else {
          setAccessDenied(true);
          setLoading(false);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error('Failed to verify access matrix privileges:', err);
      if (!canView) setAccessDenied(true);
      setLoading(false);
    }
  };

  const fetchKsebDataset = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb/${customerId}/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }
      if (res.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.site_visit_flags) {
          setSiteVisitFlags({
            ownership_change: data.site_visit_flags.ownership_change === "Yes",
            load_enhancement: data.site_visit_flags.load_enhancement === "Yes"
          });
        }
        if (data.kseb) {
          setKsebRecord(data.kseb);
          setFormData({
            ownership_status: data.kseb.ownership_status || "Pending",
            ownership_comment: data.kseb.ownership_comment || "",
            load_enhancement_status: data.kseb.load_enhancement_status || "Pending",
            load_enhancement_comment: data.kseb.load_enhancement_comment || "",
            feasibility_status: data.kseb.feasibility_status || "Pending",
            comments: data.kseb.comments || "",
            fee_paid: !!data.kseb.fee_paid,
            payment_date: data.kseb.payment_date || "",
            visiter_name: data.kseb.visiter_name || ""
          });
        } else {
          resetFormState();
        }
      }
    } catch (err) {
      console.error("Failed to load KSEB profile data", err);
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    setKsebRecord(null);
    setFormData({
      ownership_status: "Pending",
      ownership_comment: "",
      load_enhancement_status: "Pending",
      load_enhancement_comment: "",
      feasibility_status: "Pending",
      comments: "",
      fee_paid: false,
      payment_date: "",
      visiter_name: ""
    });
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb/request-access/`, {
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

  const handleInputChange = (e) => {
    if (!canUpdate) return;
    const { name, value, type, checked } = e.target;
    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      };
      if (name === 'fee_paid' && !checked && updated.feasibility_status === 'Complete') {
        updated.feasibility_status = 'Pending';
      }
      return updated;
    });
  };

  const handleSaveClick = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save KSEB Feasibility Changes",
      message: "Are you sure you want to save these KSEB feasibility record changes?",
      onConfirm: executeSaveSubmission
    });
  };

  const executeSaveSubmission = async () => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/kseb/${customerId}/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        setIsEditing(false);
        await fetchKsebDataset();
      } else {
        const errorData = await response.json();
        alert(errorData.error || "Failed to commit record updates.");
      }
    } catch (err) {
      console.error("Submission exception fault", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (ksebRecord) {
      setFormData({
        ownership_status: ksebRecord.ownership_status || "Pending",
        ownership_comment: ksebRecord.ownership_comment || "",
        load_enhancement_status: ksebRecord.load_enhancement_status || "Pending",
        load_enhancement_comment: ksebRecord.load_enhancement_comment || "",
        feasibility_status: ksebRecord.feasibility_status || "Pending",
        comments: ksebRecord.comments || "",
        fee_paid: !!ksebRecord.fee_paid,
        payment_date: ksebRecord.payment_date || "",
        visiter_name: ksebRecord.visiter_name || ""
      });
    }
  };

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the KSEB feasibility workspace.</p>
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
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>KSEB FEASIBILITY Details</h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {!canUpdate && (
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
            {siteVisitFlags.ownership_change && (
              <div className="detail-item-node">
                <span className="node-label">Ownership Change Status:</span>
                <span className="node-value" style={{ color: ksebRecord?.ownership_status === 'Complete' ? '#10b981' : '#9ca3af', fontWeight: ksebRecord?.ownership_status === 'Complete' ? 600 : 400 }}>
                  {ksebRecord?.ownership_status || "Pending"}
                </span>
              </div>
            )}


            {siteVisitFlags.load_enhancement && (
              <div className="detail-item-node">
                <span className="node-label">Load Enhancement Status:</span>
                <span className="node-value" style={{ color: ksebRecord?.load_enhancement_status === 'Complete' ? '#10b981' : '#9ca3af', fontWeight: ksebRecord?.load_enhancement_status === 'Complete' ? 600 : 400 }}>
                  {ksebRecord?.load_enhancement_status || "Pending"}
                </span>
              </div>
            )}

            <div className="detail-item-node">
              <span className="node-label">Payment Date:</span>
               {ksebRecord?.payment_date ? (
                <span className="node-value">{new Date(ksebRecord.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              ) : (
                <span style={{ fontSize: "0.65rem", color: "#64748b" }}>dd-mm-yyyy</span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Visitor Name:</span>
               {ksebRecord?.visiter_name ? (
                <span className="node-value">{ksebRecord.visiter_name}</span>
              ) : (
                <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
              )}
            </div>

            <div className="detail-item-node">
              <span className="node-label">Feasibility Status:</span>
              <span
                className="node-value"
                style={{ color: ksebRecord?.feasibility_status === 'Complete' ? '#10b981' : '#9ca3af', fontWeight: ksebRecord?.feasibility_status === 'Complete' ? 600 : 400 }}
              >
                {ksebRecord?.feasibility_status || "Pending"}
              </span>
            </div>

            <div className="detail-item-node">
              <span className="node-label">Fee Paid:</span>
              <span className={`status-badge-token-mnre ${ksebRecord?.fee_paid ? 'mnre-status-badge-completed' : 'mnre-status-badge-no'}`}>
                {ksebRecord?.fee_paid ? "Yes" : "No"}
              </span>
            </div>
          </div>

          {siteVisitFlags.ownership_change && (
            <div className="text-narrative-block" style={{ marginTop: "12px" }}>
              <label className="narrative-label">Ownership Change Comment</label>
              <p className="comments-text-display">{ksebRecord?.ownership_comment || "No comments entered."}</p>
            </div>
          )}

          {siteVisitFlags.load_enhancement && (
            <div className="text-narrative-block" style={{ marginTop: "12px" }}>
              <label className="narrative-label">Load Enhancement Comment</label>
              <p className="comments-text-display">{ksebRecord?.load_enhancement_comment || "No comments entered."}</p>
            </div>
          )}

          <div className="text-narrative-block" style={{ marginTop: "12px" }}>
              <label className="narrative-label">Comments</label>
              <p className="comments-text-display">{ksebRecord?.comments || "No comments entered."}</p>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && (
              <button type="button" className="btn-action-edit" onClick={() => setIsEditing(true)}>
                <FaEdit /> Edit Details
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveClick} className="interactive-form-workspace">
          <h2 className="workspace-pane-title">Edit KSEB FEASIBILITY</h2>
          
          <div className="form-grid-layout">
            {siteVisitFlags.ownership_change && (
              <div className="form-group-element">
                <label>Ownership Change Status *</label>
                <select name="ownership_status" value={formData.ownership_status} onChange={handleInputChange} disabled={!canUpdate} className="control-select-dropdown">
                  <option value="Pending">Pending</option>
                  <option value="Complete">Complete</option>
                </select>
              </div>
            )}

            {siteVisitFlags.load_enhancement && (
              <div className="form-group-element">
                <label>Load Enhancement Status *</label>
                <select name="load_enhancement_status" value={formData.load_enhancement_status} onChange={handleInputChange} disabled={!canUpdate} className="control-select-dropdown">
                  <option value="Pending">Pending</option>
                  <option value="Complete">Complete</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-grid-layout">
            {/* Registration Submitted & Date */}
            <div className="checkbox-date-row-group">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input 
                    type="checkbox" 
                    name="fee_paid" 
                    checked={formData.fee_paid} 
                    onChange={handleInputChange} 
                    disabled={!canUpdate} 
                    className="kseb-custom-checkbox" 
                  />
                  <span className="kseb-label-text">Fee Paid</span>
                </label>
              </div>
              </div>
              </div>
              <div className="form-grid-layout">
              <div className="form-group-element">
              <label>Payment Date *</label>
              <input
                type="date"
                name="payment_date"
                value={formData.payment_date}
                onChange={(e) => {
                      if (formData.fee_paid) {
                      handleInputChange(e);
                    }
                  }}
                disabled={!canUpdate || !formData.fee_paid}
                className="control-input-field"
                required={formData.fee_paid}
                style={!formData.fee_paid ? { color: "#9ca3af", backgroundColor: "#f3f4f6", cursor: "not-allowed" }  : undefined }
              />
            {!formData.fee_paid && (
                <span style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "4px", display: "block" }}>
                  Mark fee as paid to enable Complete
                </span>
              )}
              </div>
      
            </div>
            <div className="form-group-element">
              <label>Visitor Name</label>
              <input
                type="text"
                name="visiter_name"
                value={formData.visiter_name}
                onChange={handleInputChange}
                disabled={!canUpdate}
                className="control-input-field"
              />
            </div>
            <div className="form-group-element">
              <label>Feasibility Status *</label>
              <select
                name="feasibility_status"
                value={formData.feasibility_status}
                onChange={handleInputChange}
                disabled={!canUpdate || !formData.fee_paid}
                className="control-select-dropdown"
                style={!formData.fee_paid ? { color: "#9ca3af", backgroundColor: "#f3f4f6", cursor: "not-allowed" } : undefined}
              >
                <option value="Pending">Pending</option>
                <option value="Complete">Complete</option>
              </select>
              {!formData.fee_paid && (
                <span style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "4px", display: "block" }}>
                  Mark fee as paid to enable Complete
                </span>
              )}
              </div>
            
          

          {siteVisitFlags.ownership_change && (
            <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
              <label>Ownership Change Comment</label>
              <textarea name="ownership_comment" value={formData.ownership_comment} onChange={handleInputChange} disabled={!canUpdate} rows="2" />
            </div>
          )}

          {siteVisitFlags.load_enhancement && (
            <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
              <label>Load Enhancement Comment</label>
              <textarea name="load_enhancement_comment" value={formData.load_enhancement_comment} onChange={handleInputChange} disabled={!canUpdate} rows="2" />
            </div>
          )}

          <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
            <label>Comments</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!canUpdate} rows="3" />
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
            <button type="button" className="btn-action-cancel" onClick={handleCancel}>Cancel</button>
          </div>
        </form>
      )}

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default Kseb;