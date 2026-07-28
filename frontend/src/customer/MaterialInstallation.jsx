import React, { useState, useEffect, useMemo, useRef } from "react";
import { FaLock, FaEdit, FaFilePdf, FaFileAlt, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";
import MaterialItem from "./MaterialItem";

const getPdfPreviewUrl = (path) => {
  if (!path) return "#";
  if (path.toLowerCase().endsWith('.pdf') || path.includes('/raw/upload/')) {
    return `https://docs.google.com/viewerng/viewer?url=${encodeURIComponent(path)}`;
  }
  return path;
};

const emptyGeneralForm = () => ({
  electrical_installed: false,
  structure_installed: false,
  installation_team: "",
  installation_completion_date: "",
  comments: "",
});

const MaterialInstallation = ({ customerId }) => {
  const { role, permissions, refetchPermissions } = useAuth();
  const [siteVisitChanges, setSiteVisitChanges] = useState("");

  const isAdmin = role && role.trim().toLowerCase() === 'admin';

  const modulePermissions = useMemo(
    () => isAdmin
      ? { view: true, create: true, update: true, delete: true }
      : (permissions["Installation Progress"] || permissions["Installation Progress"] || permissions["Installation Progress"] || { view: false, create: false, update: false, delete: false }),
    [isAdmin, permissions]
  );

  const canView = isAdmin || modulePermissions.view;
  const canUpdate = isAdmin || modulePermissions.update;

  const [pendingRequests, setPendingRequests] = useState({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("installation"); // "installation" | "materials"

  const [installationData, setInstallationData] = useState(null);
  const [formData, setFormData] = useState(emptyGeneralForm());

  const [existingImages, setExistingImages] = useState([]);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [removedImages, setRemovedImages] = useState([]);

  const [existingDoc, setExistingDoc] = useState(null);
  const [newDocFile, setNewDocFile] = useState(null);

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

  const imagePreviewsRef = useRef(imagePreviews);
  imagePreviewsRef.current = imagePreviews;
  useEffect(() => {
    return () => {
      imagePreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/installation/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchInstallationDataset();
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

  const fetchInstallationDataset = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/installation/${customerId}/`, {
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
        if (data.installation) {
          setSiteVisitChanges(data.site_visit_changes || "");
          setInstallationData(data.installation);
          setFormData({
            electrical_installed: !!data.installation.electrical_installed,
            structure_installed: !!data.installation.structure_installed,
            installation_team: data.installation.installation_team || "",
            installation_completion_date: data.installation.installation_completion_date ? data.installation.installation_completion_date.substring(0, 10) : "",
            comments: data.installation.comments || ""
          });

          setExistingImages(data.installation.installation_images || []);
          setExistingDoc(data.installation.installation_document || null);
        } else {
          resetFormState();
        }
      }
    } catch (err) {
      console.error("Failed to load installation payload", err);
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    setInstallationData(null);
    setFormData(emptyGeneralForm());
    setExistingImages([]);
    setNewImageFiles([]);
    setImagePreviews([]);
    setRemovedImages([]);
    setExistingDoc(null);
    setNewDocFile(null);
    setSiteVisitChanges("");
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/installation/request-access/`, {
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

  const handleImageSelect = (e) => {
    if (!canUpdate) return;
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setNewImageFiles((prev) => [...prev, ...files]);
      const newUrls = files.map((file) => URL.createObjectURL(file));
      setImagePreviews((prev) => [...prev, ...newUrls]);
    }
  };

  const handleRemoveExistingImage = (url) => {
    if (!canUpdate) return;
    setExistingImages((prev) => prev.filter((img) => img !== url));
    setRemovedImages((prev) => [...prev, url]);
  };

  const handleRemoveNewImage = (idx) => {
    if (!canUpdate) return;
    setImagePreviews((prev) => {
      const removedUrl = prev[idx];
      if (removedUrl) URL.revokeObjectURL(removedUrl);
      return prev.filter((_, i) => i !== idx);
    });
    setNewImageFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveClick = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save Material Installation Changes",
      message: "Are you sure you want to save these material installation changes?",
      onConfirm: executeSaveSubmission
    });
  };

  const executeSaveSubmission = async () => {
    setIsEditing(false);
    setSaving(true);
    setModalConfig((prev) => ({ ...prev, isOpen: false }));

    const payload = new FormData();
    Object.keys(formData).forEach((key) => {
      payload.append(key, formData[key]);
    });

    if (newDocFile) {
      payload.append("installation_document", newDocFile);
    }

    newImageFiles.forEach((file) => {
      payload.append("installation_images", file);
    });

    payload.append("removed_images", JSON.stringify(removedImages));

    const method = installationData ? "PUT" : "POST";

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/installation/${customerId}/`, {
        method: method,
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: payload
      });
      if (res.ok) {
        setNewImageFiles([]);
        imagePreviews.forEach((url) => URL.revokeObjectURL(url));
        setImagePreviews([]);
        setRemovedImages([]);
        setNewDocFile(null);
        await fetchInstallationDataset();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to commit record updates.");
        setIsEditing(true);
      }
    } catch (err) {
      console.error("Submission exception fault", err);
      setIsEditing(true);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setNewImageFiles([]);
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImagePreviews([]);
    setRemovedImages([]);
    setNewDocFile(null);
    if (installationData) {
      setFormData({
        electrical_installed: !!installationData.electrical_installed,
        structure_installed: !!installationData.structure_installed,
        installation_team: installationData.installation_team || "",
        installation_completion_date: installationData.installation_completion_date ? installationData.installation_completion_date.substring(0, 10) : "",
        comments: installationData.comments || ""
      });
      setExistingImages(installationData.installation_images || []);
      setExistingDoc(installationData.installation_document || null);
    }
  };

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the Material Installation workspace.</p>
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
      {(loading || saving) && activeTab === "installation" && (
        <div className="sitevisit-loading-overlay">
          <div className="table-spinner"></div>
          <span>Loading...</span>
        </div>
      )}

      <div className="site-details-deck">
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

      <div className="workspace-section-header">
        <div className="workspace-tab-row">
          <button
            type="button"
            onClick={() => setActiveTab("installation")}
            className={`workspace-tab-btn ${activeTab === "installation" ? "active" : ""}`}
          >
            Installation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("materials")}
            className={`workspace-tab-btn ${activeTab === "materials" ? "active" : ""}`}
          >
            Material Items
          </button>
        </div>
      </div>

      {activeTab === "materials" ? (
        <MaterialItem customerId={customerId} canUpdate={canUpdate} mode="usage" />
      ) : !isEditing ? (
        <div className="site-details-deck">
          <div className="detail-data-grid">
            <div className="detail-item-node">
              <span className="node-label">Electrical Installation:</span>
              <span className={`node-value ${installationData?.electrical_installed ? "status-success" : "status-danger"}`}>
                {installationData?.electrical_installed ? "Completed" : "Pending"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Structure Installation:</span>
              <span className={`node-value ${installationData?.structure_installed ? "status-success" : "status-danger"}`}>
                {installationData?.structure_installed ? "Completed" : "Pending"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Installation Team:</span>
              <span className="node-value">{installationData?.installation_team || "N/A"}</span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Completion Date:</span>
              <span className="node-value">{installationData?.installation_completion_date ? installationData.installation_completion_date.substring(0, 10) : "N/A"}</span>
            </div>
          </div>

          {existingDoc && (
            <div className="document-vault-section mt-15">
              <h4 className="vault-group-title">Installation Document</h4>
              <div className="doc-preview-badge-row">
                <a href={getPdfPreviewUrl(existingDoc)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                  <FaFilePdf /> View Installation Document
                </a>
              </div>
            </div>
          )}

          {/* Conditional wrapper so 'Changes' only shows if text exists */}
          {siteVisitChanges && (
            <div className="text-narrative-block mt-12">
              <label className="narrative-label">Changes</label>
              <p className="comments-text-display">{siteVisitChanges}</p>
            </div>
          )}

          <div className="text-narrative-block mt-12">
            <label className="narrative-label">Comments</label>
            <p className="comments-text-display">{installationData?.comments || "No comments filed."}</p>
          </div>

          {existingImages.length > 0 && (
            <div className="document-vault-section mt-15">
              <h4 className="vault-group-title">Installation Proof Photos</h4>
              <div className="payment-receipts-gallery-grid">
                {existingImages.map((imgUrl, i) => (
                  <a key={i} href={imgUrl} target="_blank" rel="noopener noreferrer" className="receipt-gallery-item-card">
                    <img src={imgUrl} alt={`installation-proof-${i}`} className="gallery-thumbnail-element" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="workspace-action-trigger-row center-aligned-row mt-20">
            {canUpdate && (
              <button type="button" className="btn-action-edit" onClick={() => setIsEditing(true)}>
                <FaEdit /> Edit Details
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveClick} className="interactive-form-workspace">
          <h2 className="workspace-pane-title" style={{marginBottom:"18px"}}>Edit Installation Details</h2>

          <div className="form-grid-layout">
            <div className="form-group-element">
              <label>Installation Team</label>
              <input type="text" name="installation_team" value={formData.installation_team} onChange={handleInputChange} disabled={!canUpdate}/>
            </div>
            <div className="form-group-element">
              <label>Completion Date</label>
              <input type="date" name="installation_completion_date" value={formData.installation_completion_date} onChange={handleInputChange} disabled={!canUpdate} />
            </div>
          </div>

          <div className="vault-uploader-block mt-16">
            <h4 className="vault-group-title">Installation Checklist</h4>
            <div className="form-grid-layout pt-8">
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input type="checkbox" name="electrical_installed" checked={formData.electrical_installed} onChange={handleInputChange} disabled={!canUpdate} />
                  <span className="kseb-checkbox-text">Electrical Installation Completed</span>
                </label>
              </div>
              <div className="form-group-element">
                <label className="kseb-checkbox-custom-label">
                  <input type="checkbox" name="structure_installed" checked={formData.structure_installed} onChange={handleInputChange} disabled={!canUpdate} />
                  <span className="kseb-checkbox-text">Structure Installation Completed</span>
                </label>
              </div>
            </div>
          </div>

          {/* Conditional wrapper for edit mode changes textarea too if desired */}
          {siteVisitChanges && (
            <div className="form-group-element textarea-full-span mt-16">
              <label>Changes</label>
              <textarea name="comments" value={siteVisitChanges} rows="3" disabled={!canUpdate} readOnly />
            </div>
          )}

          <div className="form-group-element textarea-full-span mt-16">
            <label>Comments</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} rows="3" disabled={!canUpdate} />
          </div>

          <div className="vault-uploader-block mt-16">
            <h4 className="vault-group-title">Upload Installation Certificate</h4>
            <div className="form-group-element">
              <input type="file" accept=".pdf" onChange={(e) => setNewDocFile(e.target.files[0])} disabled={!canUpdate} className="vault-raw-file-selector" />
            </div>
          </div>

          <div className="vault-uploader-block mt-16">
            <h4 className="vault-group-title">Upload Installation Photos</h4>
            <div className="form-group-element multi-file-zone-pad">
              <input type="file" multiple accept="image/*" onChange={handleImageSelect} disabled={!canUpdate} className="vault-raw-file-selector" />
            </div>

            <div className="interactive-gallery-preview-deck">
              {existingImages.map((url, i) => (
                <div key={`exist-${i}`} className="gallery-preview-wrapper-node">
                  <img src={url} alt="cloud installation asset" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveExistingImage(url)} disabled={!canUpdate}>✖</button>
                </div>
              ))}
              {imagePreviews.map((blobUrl, i) => (
                <div key={`local-${i}`} className="gallery-preview-wrapper-node">
                  <img src={blobUrl} alt="local installation preview" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveNewImage(i)} disabled={!canUpdate}>✖</button>
                </div>
              ))}
            </div>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row mt-20">
            {canUpdate && (
              <button type="submit" className="btn-action-edit" disabled={saving}>
                Save Changes
              </button>
            )}
            <button type="button" className="btn-action-cancel" onClick={handleCancelEdit} disabled={saving}>
              Cancel
            </button>
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

export default MaterialInstallation;