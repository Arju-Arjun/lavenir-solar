import React, { useState, useEffect, useMemo } from "react";
import { FaLock, FaEdit, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";

const defaultFormState = {
  installation_status: "Pending",
  installation_date: "",
  comments: "",
  approval_status: "Pending",
  approval_date: "",
  subsidy_status: "Pending",
  subsidy_amount: 0.0,
  subsidy_received_date: ""
};

const MNREInstallation = ({ customerId }) => {
  const { role, permissions, refetchPermissions, isAdmin } = useAuth();
  
  const modulePermissions = useMemo(
    () => isAdmin
      ? { view: true, create: true, update: true, delete: true }
      : (permissions["MNRE Installation"] || permissions["MNRE Installation"] || { view: false, create: false, update: false, delete: false }),
    [isAdmin, permissions]
  );

  const canView = isAdmin || modulePermissions.view;
  const canUpdate = isAdmin || modulePermissions.update;

  const [loading, setLoading] = useState(false);
  const [checkingProfileStatus, setCheckingProfileStatus] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  
  const [pendingRequests, setPendingRequests] = useState({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const [mnreProfileCompleted, setMnreProfileCompleted] = useState(false);
  const [installationData, setInstallationData] = useState(null);
  const [formData, setFormData] = useState(defaultFormState);

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
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-installation/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          verifyMNREProfileStatus();
        } else {
          setAccessDenied(true);
          setCheckingProfileStatus(false);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
        setCheckingProfileStatus(false);
      }
    } catch (err) {
      console.error('Failed to verify access matrix privileges:', err);
      if (!canView) setAccessDenied(true);
      setCheckingProfileStatus(false);
    }
  };

  const verifyMNREProfileStatus = async () => {
    setCheckingProfileStatus(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-installation/${customerId}/`, {
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
        if (data.mnre_profile_status === 'Completed') {
          setMnreProfileCompleted(true);
          if (data.installation) {
            setInstallationData(data.installation);
            setFormData({
              installation_status: data.installation.installation_status || "Pending",
              installation_date: data.installation.installation_date ? data.installation.installation_date.substring(0, 10) : "",
              comments: data.installation.comments || "",
              approval_status: data.installation.approval_status || "Pending",
              approval_date: data.installation.approval_date ? data.installation.approval_date.substring(0, 10) : "",
              subsidy_status: data.installation.subsidy_status || "Pending",
              subsidy_amount: data.installation.subsidy_amount || 0.0,
              subsidy_received_date: data.installation.subsidy_received_date ? data.installation.subsidy_received_date.substring(0, 10) : ""
            });
          }
        } else {
          setMnreProfileCompleted(false);
        }
      }
    } catch (err) {
      console.error("Failed to verify MNRE profile compliance status", err);
    } finally {
      setCheckingProfileStatus(false);
    }
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-installation/request-access/`, {
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
        alert(res.message );
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
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveClick = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save MNRE Installation Changes",
      message: "Are you sure you want to save these MNRE installation changes?",
      onConfirm: executeSaveSubmission
    });
  };

  const executeSaveSubmission = async () => {
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-installation/${customerId}/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setIsEditing(false);
        verifyMNREProfileStatus();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to commit record updates.");
      }
    } catch (err) {
      console.error("Submission exception fault", err);
    } finally {
      setLoading(false);
    }
  };

  if (checkingProfileStatus) {
    return (
      <div className="table-loader-container">
        <div className="table-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the MNRE Installation workspace.</p>
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

  if (!mnreProfileCompleted) {
    return (
      <div className="permission-locked-wrapper-card mnre-locked-card-override">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon mnre-locked-icon-override" />
          <h3 className="mnre-locked-heading-override">MNRE Installation Workspace Locked</h3>
          <p className="mnre-locked-text-override">
            This module container will remain offline until the parent 
            <strong> MNRE Profile</strong> status is successfully marked as <strong>Completed</strong>.
          </p>
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
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>MNRE Installation Details</h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {installationData && !canUpdate && (
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
      
          <div className="detail-data-grid" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "stretch" }}>
            <div className="detail-item-node" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "84px" }}>
              <span className="node-label">Installation Status:</span>
              <span className="node-value" style={{ color: installationData?.installation_status === 'Completed' ? '#10b981' : '#ef4444',fontWeight: "600",fontSize: "0.875rem" }}>
                {installationData?.installation_status || "Pending"} 
                </span>
                <span className="payment-flow-date-badge">
                {installationData?.installation_date ? `(${installationData.installation_date})` : ""}
              </span>
              
            </div>
            <div className="detail-item-node" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "84px" }}>
              <span className="node-label">Approval Status:</span>
              <span className="node-value" style={{ color: installationData?.approval_status === 'Approved' ? '#10b981' : '#ef4444',fontWeight: "600",fontSize: "0.875rem" }}>
                {installationData?.approval_status || "Pending"}
              </span>
              <span className="payment-flow-date-badge">
                {installationData?.approval_date ? `(${installationData.approval_date})` : ""}
              </span>

            </div>
            <div className="detail-item-node" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "84px" }}>
              <span className="node-label">Subsidy Status:</span>
              <span className="node-value" style={{ color: installationData?.subsidy_status === 'Received' ? '#10b981' : '#ef4444',fontWeight: "600",fontSize: "0.875rem" }}>
                {installationData?.subsidy_status || "Pending"}
              </span>
              <span className="payment-flow-date-badge">
                {installationData?.subsidy_received_date ? `(${installationData.subsidy_received_date})` : ""}
              </span>
            </div>
            
            {installationData?.subsidy_amount > 0 && (
            <div className="detail-item-node" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "84px" }}>
              <span className="node-label">Subsidy Amount:</span>
              <span className="node-value" style={{ fontWeight: "600",fontSize: "0.875rem" }}>
                ₹{(parseFloat(installationData?.subsidy_amount) || 0).toLocaleString('en-IN')}
              </span>
            </div>
            )}
          </div>

          <div className="text-narrative-block" style={{ marginTop: "15px" }}>
            <label className="narrative-label">Comments & Notes</label>
            <p className="comments-text-display">{installationData?.comments || "No comments filed."}</p>
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
        <form onSubmit={handleSaveClick} className="interactive-form-workspace">
          <h2 className="workspace-pane-title">Edit MNRE Installation</h2>
          
          <div className="form-grid-layout">
            <div className="form-group-element">
              <label>Installation Status *</label>
              <select name="installation_status" className="control-select-dropdown" value={formData.installation_status} onChange={handleInputChange} disabled={!canUpdate} required>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div className="form-group-element">
              <label>Installation Date</label>
              <input type="date" name="installation_date" value={formData.installation_date} onChange={handleInputChange} disabled={!canUpdate} />
            </div>

            <div className="form-group-element">
              <label>Approval Status *</label>
              <select name="approval_status" className="control-select-dropdown" value={formData.approval_status} onChange={handleInputChange} disabled={!canUpdate} required>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
              </select>
            </div>
            <div className="form-group-element">
              <label>Approval Date</label>
              <input type="date" name="approval_date" value={formData.approval_date} onChange={handleInputChange} disabled={!canUpdate} />
            </div>

            <div className="form-group-element">
              <label>Subsidy Status *</label>
              <select name="subsidy_status" className="control-select-dropdown" value={formData.subsidy_status} onChange={handleInputChange} disabled={!canUpdate} required>
                <option value="Pending">Pending</option>
                <option value="Received">Received</option>
              </select>
            </div>
            <div className="form-group-element">
              <label>Subsidy Amount (₹)</label>
              <input type="number" step="0.01" min="0" name="subsidy_amount" value={formData.subsidy_amount} onChange={handleInputChange} disabled={!canUpdate} />
            </div>
            <div className="form-group-element">
              <label>Subsidy Received Date</label>
              <input type="date" name="subsidy_received_date" value={formData.subsidy_received_date} onChange={handleInputChange} disabled={!canUpdate} />
            </div>
          </div>

          <div className="form-group-element textarea-full-span" style={{ marginTop: "15px" }}>
            <label>Comments & Notes</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!canUpdate} rows="3" />
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
            <button type="button" className="btn-action-cancel" onClick={() => {
              setIsEditing(false);
              if (installationData) {
                setFormData({
                  installation_status: installationData.installation_status || "Pending",
                  installation_date: installationData.installation_date ? installationData.installation_date.substring(0, 10) : "",
                  comments: installationData.comments || "",
                  approval_status: installationData.approval_status || "Pending",
                  approval_date: installationData.approval_date ? installationData.approval_date.substring(0, 10) : "",
                  subsidy_status: installationData.subsidy_status || "Pending",
                  subsidy_amount: installationData.subsidy_amount || 0.0,
                  subsidy_received_date: installationData.subsidy_received_date ? installationData.subsidy_received_date.substring(0, 10) : ""
                });
              } else {
                setFormData(defaultFormState);
              }
            }}>Cancel</button>
          </div>
        </form>
      )}

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default MNREInstallation;