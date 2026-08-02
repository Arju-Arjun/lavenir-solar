import React, { useState, useEffect, useRef } from "react";
import { FaLock, FaEdit, FaFilePdf, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";

const getPdfPreviewUrl = (path) => {
  if (!path) return "#";
  if (path.toLowerCase().endsWith('.pdf') || path.includes('/raw/upload/')) {
    // return `https://docs.google.com/gview?url=${encodeURIComponent(path)}&embedded=true`;
    return `https://docs.google.com/viewerng/viewer?url=${encodeURIComponent(path)}`;
  }
  return path;
};

const MNREProfileView = ({ customerId }) => {
  const { permissions, isAdmin, role, refetchPermissions } = useAuth();
  
  const moduleAccess = permissions["MNRE Profile"] || permissions["MNREProfile"] || { view: false, create: false, update: false };
  const canView = isAdmin || role === 'admin' || moduleAccess.view;
  const canUpdate = isAdmin || role === 'admin' || moduleAccess.update;

  const hasFetchedRef = useRef(null);

  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [visitFeasibility, setVisitFeasibility] = useState(false);
  const [mnreData, setMnreData] = useState(null);
  const [pendingRequests, setPendingRequests] = useState({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  
  const [documentFiles, setDocumentFiles] = useState({});
  const [formData, setFormData] = useState({
    mnre_status: "Pending",
    comments: ""
  });

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  useEffect(() => {
    if (hasFetchedRef.current === customerId) {
      return;
    }

    if (customerId) {
      hasFetchedRef.current = customerId;
      fetchAccessRequests();
    } else {
      setInitializing(false);
    }
  }, [customerId]);

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-profile/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          verifySiteFeasibility();
        } else {
          setAccessDenied(true);
          setInitializing(false);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
        setInitializing(false);
      }
    } catch (err) {
      console.error('Failed to check access privileges:', err);
      if (!canView) {
        setAccessDenied(true);
      }
      setInitializing(false);
    }
  };

  const verifySiteFeasibility = async () => {
    try {
      const visitRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/site-visit/${customerId}/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      
      if (visitRes.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }

      if (visitRes.ok) {
        const visitData = await visitRes.json();
        if (visitData.visit && visitData.visit.feasibility === "Yes") {
          setVisitFeasibility(true);
          await fetchMNREDataset();
        } else {
          setVisitFeasibility(false);
        }
      }
    } catch (err) {
      console.error("Initialization fault on pipeline verification", err);
    } finally {
      setInitializing(false);
    }
  };

  const fetchMNREDataset = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-profile/${customerId}/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });

      if (response.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (data.profile) {
          setMnreData(data.profile);
          setFormData({
            mnre_status: data.profile.mnre_status || "Pending",
            comments: data.profile.comments || ""
          });
        }
      }
    } catch (err) {
      console.error("Error retrieving MNRE payload matrix", err);
    }
  };

  const handleRequestAccess = async (type) => {
    setRequestLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-profile/request-access/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ permission_type: type })
      });
      if (res.ok) {
        const result = await res.json();
        setPendingRequests(prev => ({ ...prev, [type]: "Pending" }));
        alert(result.message );
        
        if (refetchPermissions) {
          await refetchPermissions();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRequestLoading(false);
    }
  };

  const handleInputChange = (e) => {
    if (!canUpdate) return;
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    if (!canUpdate) return;
    const { name, files } = e.target;
    if (files && files[0]) {
      setDocumentFiles((prev) => ({ ...prev, [name]: files[0] }));
    }
  };

  const triggerSaveConfirm = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required update clearance parameters.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save MNRE Profile Changes",
      message: "Are you sure you want to save this MNRE profile data?",
      onConfirm: executeSubmission
    });
  };

  const executeSubmission = async () => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);
    
    const payload = new FormData();
    payload.append("mnre_status", formData.mnre_status);
    payload.append("comments", formData.comments);
    if (documentFiles.feasibility_file) payload.append("feasibility_file", documentFiles.feasibility_file);
    if (documentFiles.ack_file) payload.append("ack_file", documentFiles.ack_file);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/mnre-profile/${customerId}/`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: payload
      });
      if (response.ok) {
        setIsEditing(false);
        setDocumentFiles({});
        fetchMNREDataset();
      } else {
        alert("Transaction validation failure occurred during processing.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
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
          <h3>Access Restricted </h3>
          <p>You don't have permission to access the MNRE setup details.</p>
          {pendingRequests["view"] === "Pending" ? (
            <div className="sitevisit-alert-success-banner">⚠️ View Request Pending Approval</div>
          ) : (
            <button
              type="button"
              className="request-access-trigger-btn"
              onClick={() => handleRequestAccess("view")}
              disabled={requestLoading || pendingRequests["view"] === "Pending"}
            >
              Request View Access
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!visitFeasibility) {
    return (
      <div className="permission-locked-wrapper-card mnre-locked-card-override">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon mnre-locked-icon-override" />
          <h3 className="mnre-locked-heading-override">MNRE Profile Locked</h3>
          <p className="mnre-locked-text-override">
            This profile workspace container will remain offline until structural verification updates inside the 
            <strong> Site Visit Workspace</strong> match an authorized <strong>Feasibility: Yes</strong> state metric.
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
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>MNRE PROFILE</h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {!canUpdate && (
                pendingRequests["update"] === "Pending" ? (
                  <span style={{ fontSize: "0.8rem", color: "#ca8a04", fontWeight: "600" }}>⚠️ Update Request Pending</span>
                ) : (
                  <button type="button" onClick={() => handleRequestAccess("update")} disabled={requestLoading} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", padding: "4px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", color: "#475569" }}>
                    <FaPaperPlane size={10} /> Request Update Authorization
                  </button>
                )
              )}
            </div>
          </div>

          {mnreData ? (
            <>
              <div className="detail-data-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                <div className="detail-item-node">
                  <span className="node-label">Registration :</span>
                  <span className="node-value text-emerald">Active </span>
                </div>
                <div className="detail-item-node">
                  <span className="node-label">MNRE Profile Status:</span>
                  <span className={`status-badge-token-mnre ${mnreData.mnre_status === 'Completed' ? 'mnre-status-badge-completed' : 'mnre-status-badge-pending'}`}>
                    {mnreData.mnre_status}
                  </span>
                </div>
              </div>

              <div className="text-narrative-block mnre-margin-top-md">
                <label className="narrative-label">Comments</label>
                <p className="comments-text-display">{mnreData.comments || ""}</p>
              </div>

              {mnreData.ack_file || mnreData.feasibility_file ? (
                <div className="document-vault-section">
                  <h4 className="vault-group-title">Formal Verification Certificates</h4>
                  <div className="doc-preview-badge-row">
                    {mnreData.ack_file && (
                      <a href={getPdfPreviewUrl(mnreData.ack_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                        <FaFilePdf /> Acknowledgment Certificate
                      </a>
                    )}
                    {mnreData.feasibility_file && (
                      <a href={getPdfPreviewUrl(mnreData.feasibility_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                        <FaFilePdf /> Feasibility Certificate
                      </a>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
                {canUpdate && (
                  <button type="button" className="btn-action-edit" onClick={() => setIsEditing(true)}>
                    <FaEdit /> Edit Details
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="centered-placeholder-box">
              <p className="placeholder-primary-msg">No MNRE profile has been created yet.</p>
              {canUpdate ? (
                <button type="button" className="btn-action-edit mnre-placeholder-btn-wrapper" onClick={() => setIsEditing(true)}>
                  <FaEdit /> Initialize MNRE Profile
                </button>
              ) : (
                pendingRequests["update"] === "Pending" ? (
                  <div className="sitevisit-alert-success-banner">⚠️ Update Request Pending Approval</div>
                ) : (
                  <button type="button" className="request-access-trigger-btn" onClick={() => handleRequestAccess("update")}>
                    Request Matrix Init Clearance
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={triggerSaveConfirm} className="interactive-form-workspace">
          <h2 className="workspace-pane-title"> Edit MNRE PROFILE</h2>
          
          <div className="form-grid-layout mnre-form-spacing">
            <div className="form-group-element">
              <label>MNRE Process Status *</label>
              <select name="mnre_status" className="control-select-dropdown mnre-select-input-wrapper" value={formData.mnre_status} onChange={handleInputChange} disabled={!canUpdate} required>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="form-group-element textarea-full-span mnre-margin-top-md">
            <label>Comments</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!canUpdate} rows="3" />
          </div>

          <div className="vault-uploader-block mnre-margin-top-md">
            <h4 className="vault-group-title">Certificate Upload</h4>
            <div className="form-grid-layout">
              <div className="form-group-element">
                <label>
                  {mnreData?.feasibility_file && <span className="vault-upload-status-tick">✓ </span>}
                  Feasibility File
                </label>
                <input type="file" name="feasibility_file" accept=".pdf" className="vault-raw-file-selector" onChange={handleFileChange} disabled={!canUpdate} />
              </div>
              <div className="form-group-element">
                <label>
                  {mnreData?.ack_file && <span className="vault-upload-status-tick">✓ </span>}
                  Acknowledgment File
                </label>
                <input type="file" name="ack_file" accept=".pdf" className="vault-raw-file-selector" onChange={handleFileChange} disabled={!canUpdate} />
              </div>
            </div>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row mnre-margin-top-lg">
            {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
            <button type="button" className="btn-action-cancel" onClick={() => {
              setIsEditing(false);
              setDocumentFiles({});
              setFormData({
                mnre_status: mnreData?.mnre_status || "Pending",
                comments: mnreData?.comments || ""
              });
            }}>Cancel</button>
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

export default MNREProfileView;