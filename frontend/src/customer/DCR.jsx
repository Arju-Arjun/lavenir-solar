import React, { useState, useEffect, useMemo } from "react";
import { FaLock, FaCloudUploadAlt, FaEye, FaFilePdf, FaEdit, FaPaperPlane } from "react-icons/fa";
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

const DCR = ({ customerId, customer }) => {
  const { permissions, refetchPermissions, isAdmin, role } = useAuth();
  
  const moduleAccess = useMemo(
    () => permissions["DCR Details"] || permissions["DCR"] || { view: false, create: false, update: false, delete: false },
    [permissions]
  );
  const canView = isAdmin || role === 'admin' || moduleAccess.view;
  const canUpdate = isAdmin || role === 'admin' || moduleAccess.update;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState({});
  const [requestLoading, setRequestLoading] = useState(false);
  
  const [dcrEdit, setDcrEdit] = useState(false);
  const [dcrData, setDcrData] = useState(null);
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [formData, setFormData] = useState({
    certificate_received: false,
    certificate_claimed: false,
    certificate_sold: false,
    comments: ""
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
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dcr/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchDcrDataset();
        } else {
          setAccessDenied(true);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
      }
    } catch (err) {
      console.error('Failed to verify access matrix privileges:', err);
      if (!canView) setAccessDenied(true);
    }
  };

  const fetchDcrDataset = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dcr/${customerId}/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (response.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (data.dcr) {
          setDcrData(data.dcr);
          setFormData({
            certificate_received: data.dcr.certificate_received || false,
            certificate_claimed: data.dcr.certificate_claimed || false,
            certificate_sold: data.dcr.certificate_sold || false,
            comments: data.dcr.comments || ""
          });
        } else {
          resetFormDataState();
        }
      }
    } catch (err) {
      console.error("Failed to recover DCR dataset", err);
    } finally {
      setLoading(false);
    }
  };

  const resetFormDataState = () => {
    setDcrData(null);
    setFormData({
      certificate_received: false,
      certificate_claimed: false,
      certificate_sold: false,
      comments: ""
    });
    setSelectedFile(null);
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dcr/request-access/`, {
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
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const triggerSaveConfirmation = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save DCR Changes",
      message: "Are you sure you want to save these modifications to the DCR records?",
      onConfirm: executeFormSubmission
    });
  };

  const executeFormSubmission = async () => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);

    const submitPayload = new FormData();
    Object.keys(formData).forEach((key) => {
      submitPayload.append(key, formData[key]);
    });
    if (selectedFile) {
      submitPayload.append("certificate_file", selectedFile);
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dcr/${customerId}/`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: submitPayload
      });
      if (response.ok) {
        setDcrEdit(false);
        setSelectedFile(null);
        fetchDcrDataset();
      } else {
        const errorDetails = await response.json();
        alert(errorDetails.error || "Failed to commit record updates.");
      }
    } catch (err) {
      console.error("Synchronization error", err);
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
          <p>You don't have permission to access the DCR Details workspace.</p>
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

      {!dcrEdit ? (
        <div className="site-details-deck">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "15px" }}>
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>DCR Certificate Details</h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {dcrData && !canUpdate && (
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
              <span className="node-label">Certificate Received:</span>
              <span className="node-value" style={{ color: dcrData?.certificate_received ? '#10b981' : '#ef4444' }}>
                {dcrData?.certificate_received ? "Yes" : "No"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Certificate Claimed:</span>
              <span className="node-value" style={{ color: dcrData?.certificate_claimed ? '#10b981' : '#ef4444' }}>
                {dcrData?.certificate_claimed ? "Yes" : "No"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Certificate Sold:</span>
              <span className="node-value" style={{ color: dcrData?.certificate_sold ? '#10b981' : '#ef4444' }}>
                {dcrData?.certificate_sold ? "Yes" : "No"}
              </span>
            </div>
          </div>

          {dcrData?.certificate_file && (
            <div className="document-vault-section" style={{ marginTop: "15px" }}>
              <h4 className="vault-group-title">DCR Certificate Document</h4>
              <div className="doc-preview-badge-row">
                <a href={getPdfPreviewUrl(dcrData.certificate_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                  <FaFilePdf /> View Certificate Document
                </a>
              </div>
            </div>
          )}

          <div className="text-narrative-block" style={{ marginTop: "15px" }}>
            <label className="narrative-label">Comments & Notes</label>
            <p className="comments-text-display">{dcrData?.comments || "No comments written for this record."}</p>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && (
              <button type="button" className="btn-action-edit" onClick={() => setDcrEdit(true)}>
                <FaEdit /> Edit Details
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={triggerSaveConfirmation} className="interactive-form-workspace">
          <h2 className="workspace-pane-title">Edit DCR Certificate Details</h2>
          
          <div className="form-grid-layout" style={{ paddingTop: "10px" }}>
            <div className="form-group-element">
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="certificate_received" checked={formData.certificate_received} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Certificate Received</span>
              </label>
            </div>
            <div className="form-group-element">
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="certificate_claimed" checked={formData.certificate_claimed} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Certificate Claimed</span>
              </label>
            </div>
            <div className="form-group-element">
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="certificate_sold" checked={formData.certificate_sold} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Certificate Sold</span>
              </label>
            </div>
          </div>

          <div className="vault-uploader-block mnre-margin-top-md">
              <h4 className="vault-group-title">DCR Certificate</h4>
              <div className="form-group-element">
                <label>
                  {dcrData?.certificate_file && <span className="vault-upload-status-tick">✓ </span>}
                  Select DCR Certificate File
                </label>
              <input type="file" accept=".pdf,application/pdf" onChange={(e) => setSelectedFile(e.target.files[0])} disabled={!canUpdate} className="vault-raw-file-selector" />
            </div>
          </div>

          <div className="form-group-element textarea-full-span" style={{ marginTop: "15px" }}>
            <label>Comments & Notes</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!canUpdate} rows="3" />
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
            <button type="button" className="btn-action-cancel" onClick={() => {
              setDcrEdit(false);
              setSelectedFile(null);
              if (dcrData) {
                setFormData({
                  certificate_received: dcrData.certificate_received || false,
                  certificate_claimed: dcrData.certificate_claimed || false,
                  certificate_sold: dcrData.certificate_sold || false,
                  comments: dcrData.comments || ""
                });
              } else {
                resetFormDataState();
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
        onCancel={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default DCR;