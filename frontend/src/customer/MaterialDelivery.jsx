import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FaLock, FaEdit, FaBoxOpen, FaTruck, FaPaperPlane, FaFileAlt, FaTimes } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";

import MaterialItem from "./MaterialItem";

const emptyGeneralForm = () => ({
  delivery_date: "",
  electrical_delivered: false,
  structure_delivered: false,
  panel_delivered: false,
  changes: "",
  extra_material: "",
  structure_changes: "",
  delivered_by: "",
  received_by: "",
  comments: ""
});

// Same detection PaymentFlow uses for its receipts: a plain substring check
// on the URL (works reliably against Cloudinary's raw/upload URLs), or the
// File's name/mimetype for a not-yet-uploaded local file.
const isPdfSource = (source) => {
  if (typeof source === "string") {
    return source.toLowerCase().includes(".pdf");
  }
  if (source && source.name) {
    return source.name.toLowerCase().endsWith(".pdf") || (source.type && source.type === "application/pdf");
  }
  return false;
};

const getDocumentKind = (source) => (isPdfSource(source) ? "pdf" : "image");

// Delivery date is stored/sent as yyyy-mm-dd (native <input type="date">
// value, and what the backend expects/returns), but shown as dd-mm-yyyy in
// the view mode display.
const formatISOToDMY = (isoStr) => {
  if (!isoStr) return "";
  const [yyyy, mm, dd] = isoStr.split("-");
  if (!yyyy || !mm || !dd) return isoStr;
  return `${dd}-${mm}-${yyyy}`;
};

const MaterialDelivery = ({ customerId, customerName }) => {
  const { permissions, refetchPermissions, isAdmin } = useAuth();
  
  const modulePermissions = useMemo(
    () => isAdmin
      ? { view: true, create: true, update: true, delete: true }
      : (permissions["Material Delivery"] || permissions["MaterialDelivery"] || { view: false, create: false, update: false }),
    [isAdmin, permissions]
  );

  const canView = isAdmin || modulePermissions.view;
  const canUpdate = isAdmin || modulePermissions.update;

  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [pendingRequests, setPendingRequests] = useState({});
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  const [deliveryData, setDeliveryData] = useState(null);
  const [formData, setFormData] = useState(emptyGeneralForm());

  // Delivery date is picked via a date input, kept separate from
  // formData.delivery_date (which stores the saved yyyy-mm-dd value used for
  // the view-mode display). This field always starts blank when Edit is
  // opened instead of being pre-filled with the previously saved date - it's
  // only sent to the backend if the user actually picks a new value.
  const [deliveryDateInput, setDeliveryDateInput] = useState("");

  // Read-only, comes from SiteVisit on the backend (a sibling of `delivery`
  // in the API response, present even when there's no delivery record yet).
  // Kept independent of formData/deliveryData so it's never wiped out.
  const [siteVisitChanges, setSiteVisitChanges] = useState("");
  
  const [existingImages, setExistingImages] = useState([]);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [removedImages, setRemovedImages] = useState([]);

  const [existingDocuments, setExistingDocuments] = useState([]);
  const [newDocumentFiles, setNewDocumentFiles] = useState([]);
  const [newDocumentPreviews, setNewDocumentPreviews] = useState([]);
  const [removedDocuments, setRemovedDocuments] = useState([]);

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const imagePreviewsRef = useRef(imagePreviews);
  imagePreviewsRef.current = imagePreviews;

  const newDocumentPreviewsRef = useRef(newDocumentPreviews);
  newDocumentPreviewsRef.current = newDocumentPreviews;

  useEffect(() => {
    return () => {
      imagePreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      newDocumentPreviewsRef.current.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    };
  }, []);

  const fetchDeliveryDataset = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/material/${customerId}/`, {
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

        // site_visit_changes is a top-level sibling of `delivery` in the
        // response and is returned whether or not delivery exists — sync
        // it unconditionally, before branching on data.delivery below.
        setSiteVisitChanges(data.site_visit_changes || "");

        if (data.delivery) {
          setDeliveryData(data.delivery);
          setFormData({
            delivery_date: data.delivery.delivery_date || "",
            electrical_delivered: !!data.delivery.electrical_delivered,
            structure_delivered: !!data.delivery.structure_delivered,
            panel_delivered: !!data.delivery.panel_delivered,
            changes: data.delivery.changes || "",
            extra_material: data.delivery.extra_material || "",
            structure_changes: data.delivery.structure_changes || "",
            delivered_by: data.delivery.delivered_by || "",
            received_by: data.delivery.received_by || "",
            comments: data.delivery.comments || ""
          });
          setExistingImages(data.delivery.delivery_images || []);
          setExistingDocuments(data.delivery.delivery_document || []);
        } else {
          setDeliveryData(null);
          setFormData(emptyGeneralForm());
          setExistingImages([]);
          setExistingDocuments([]);
        }
      }
    } catch (err) {
      console.error("Failed to load material delivery payload", err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const fetchAccessRequests = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/material/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchDeliveryDataset();
        } else {
          setAccessDenied(true);
          setLoading(false);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
      }
    } catch (err) {
      if (!canView) setAccessDenied(true);
      setLoading(false);
    }
  }, [canView, fetchDeliveryDataset]);

  useEffect(() => {
    if (customerId) {
      fetchAccessRequests();
    }
  }, [customerId, fetchAccessRequests]);

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/material/request-access/`, {
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
      console.error("Transmission error", err);
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

  const handleDocumentSelect = (e) => {
    if (!canUpdate) return;
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setNewDocumentFiles((prev) => [...prev, ...files]);
      const newPreviews = files.map((file) => (getDocumentKind(file) === "image" ? URL.createObjectURL(file) : null));
      setNewDocumentPreviews((prev) => [...prev, ...newPreviews]);
    }
  };

  const handleRemoveExistingDocument = (url) => {
    if (!canUpdate) return;
    setExistingDocuments((prev) => prev.filter((doc) => doc !== url));
    setRemovedDocuments((prev) => [...prev, url]);
  };

  const handleRemoveNewDocument = (idx) => {
    if (!canUpdate) return;
    setNewDocumentPreviews((prev) => {
      const removedUrl = prev[idx];
      if (removedUrl) URL.revokeObjectURL(removedUrl);
      return prev.filter((_, i) => i !== idx);
    });
    setNewDocumentFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Renders a document tile using the same visual model as PaymentFlow's
  // "Upload Payment Receipts": an image thumbnail for image files, or a
  // fallback card with a file icon + type tag for PDFs.
  // `source` is either a stored URL (string) or a locally-picked File;
  // `previewUrl` is only used for not-yet-uploaded image files.
  const renderDocumentPreview = (source, previewUrl, label = "PDF") => {
    const kind = getDocumentKind(source);
    if (kind === "image") {
      const imgSrc = previewUrl || source;
      return <img src={imgSrc} alt="Delivery document" className="receipt-gallery-medium-image" />;
    }
    return (
      <div className="receipt-pdf-fallback-frame">
        <FaFileAlt className="receipt-pdf-gallery-icon" />
        <span className="receipt-pdf-text-tag">{label}</span>
      </div>
    );
  };

  const handleSaveClick = (e) => {
    if (e) e.preventDefault();
    if (!canUpdate) return;
    setModalConfig({
      isOpen: true,
      title: "Save Material Delivery Changes",
      message: "Are you sure you want to save these material delivery changes?",
      onConfirm: executeSaveSubmission
    });
  };

  const executeSaveSubmission = async () => {
    setIsEditing(false);
    setSaving(true);
    setModalConfig((prev) => ({ ...prev, isOpen: false }));

    // delivery_date is only overwritten if the user actually picked a new
    // value into the date field this session; otherwise the previously
    // saved date is resubmitted untouched.
    const submittedFormData = deliveryDateInput ? { ...formData, delivery_date: deliveryDateInput } : formData;

    const payload = new FormData();
    Object.entries(submittedFormData).forEach(([key, value]) => {
      payload.append(key, value);
    });

    newImageFiles.forEach((file) => {
      payload.append("delivery_images", file);
    });

    payload.append("removed_images", JSON.stringify(removedImages));

    newDocumentFiles.forEach((file) => {
      payload.append("delivery_document", file);
    });

    payload.append("removed_documents", JSON.stringify(removedDocuments));

    const endpoint = `${import.meta.env.VITE_API_BASE_URL}/api/material/${customerId}/`;
    const method = deliveryData ? "PUT" : "POST";

    try {
      const res = await fetch(endpoint, {
        method: method,
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: payload
      });
      if (res.ok) {
        setNewImageFiles([]);
        imagePreviews.forEach((url) => URL.revokeObjectURL(url));
        setImagePreviews([]);
        setRemovedImages([]);
        setNewDocumentFiles([]);
        newDocumentPreviews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
        setNewDocumentPreviews([]);
        setRemovedDocuments([]);
        setDeliveryDateInput("");
        await fetchDeliveryDataset();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to commit record updates.");
        setIsEditing(true);
      }
    } catch (err) {
      setIsEditing(true);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditClick = () => {
    setIsEditing(false);
    setDeliveryDateInput("");
    setNewImageFiles([]);
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImagePreviews([]);
    setRemovedImages([]);
    setNewDocumentFiles([]);
    newDocumentPreviews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    setNewDocumentPreviews([]);
    setRemovedDocuments([]);
    
    if (deliveryData) {
      setFormData({
        delivery_date: deliveryData.delivery_date || "",
        electrical_delivered: !!deliveryData.electrical_delivered,
        structure_delivered: !!deliveryData.structure_delivered,
        panel_delivered: !!deliveryData.panel_delivered,
        changes: deliveryData.changes || "",
        extra_material: deliveryData.extra_material || "",
        structure_changes: deliveryData.structure_changes || "",
        delivered_by: deliveryData.delivered_by || "",
        received_by: deliveryData.received_by || "",
        comments: deliveryData.comments || ""
      });
      setExistingImages(deliveryData.delivery_images || []);
      setExistingDocuments(deliveryData.delivery_document || []);
    } else {
      setFormData(emptyGeneralForm());
      setExistingImages([]);
      setExistingDocuments([]);
    }
    // siteVisitChanges is deliberately left untouched here — it's read-only
    // and sourced from SiteVisit, so cancelling the delivery edit has no
    // effect on it.
  };

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the Material Delivery workspace.</p>
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
      {(loading || saving) && (
        <div className="sitevisit-loading-overlay">
          <div className="table-spinner"></div>
          <span>Loading...</span>
        </div>
      )}

      <div className="site-details-deck">
        <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
          {deliveryData && !canUpdate && (
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

      {/* Navigation Matrix Headers */}
      <div className="workspace-tab-row">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`workspace-tab-btn ${activeTab === "general" ? "active" : ""}`}
        >
          <FaTruck /> Material Delivery
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("items")}
          className={`workspace-tab-btn ${activeTab === "items" ? "active" : ""}`}
        >
          <FaBoxOpen /> Material Items         </button>
      </div>

      {/* RENDER THE CHILD COMPONENT IF ITEMS TAB IS ACTIVE */}
        {activeTab === "items" && (
            <MaterialItem 
              customerId={customerId} 
              customerName={customerName}
              canUpdate={canUpdate} 
              mode="delivery" 
            />
        )}

      {/* MAIN VIEW MODE SWITCHBOARD FOR GENERAL TAB */}
      {activeTab === "general" && !isEditing && (
        <div className="site-details-deck">
          <div className="detail-data-grid">
            <div className="detail-item-node">
              <span className="node-label">Delivery Date:</span>
              {formData.delivery_date ? (
                <span className="node-value">{formatISOToDMY(formData.delivery_date)}</span>
              ) : (
                <span style={{ fontSize: "0.65rem", color: "#64748b" }}>dd-mm-yyyy</span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Electrical Items:</span>
              <span className={`status-badge-token-mnre ${formData.electrical_delivered ? 'mnre-status-badge-completed' : 'mnre-status-badge-pending'}`}>
                {formData.electrical_delivered ? "Delivered" : "Pending"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Structure Items:</span>
             <span className={`status-badge-token-mnre ${formData.structure_delivered ? 'mnre-status-badge-completed' : 'mnre-status-badge-pending'}`}>
                {formData.structure_delivered ? "Delivered" : "Pending"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Solar Panels:</span>
              <span className={`status-badge-token-mnre ${formData.panel_delivered ? 'mnre-status-badge-completed' : 'mnre-status-badge-pending'}`}>
                {formData.panel_delivered ? "Delivered" : "Pending"}
              </span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Delivered By:</span>
              {formData.delivered_by ? (
                <span className="node-value">{formData.delivered_by}</span>
              ) : (
                <span  style={{ fontSize: "0.65rem", color: "#9ca3af" }}>N/A</span>
              )}
            </div>
            <div className="detail-item-node">
              <span className="node-label">Received By:</span>
              {formData.received_by ? (
                <span className="node-value">{formData.received_by}</span>
              ) : (
                <span  style={{ fontSize: "0.65rem", color: "#9ca3af" }}>N/A</span>
              )}
            </div>
          </div>

          {siteVisitChanges && (
            <div className="text-narrative-block mt-12">
              <label className="narrative-label">Changes</label>
              <p className="comments-text-display">{siteVisitChanges}</p>
            </div>
          )}

          {formData.comments && (
            <div className="text-narrative-block mt-12">
              <label className="narrative-label">Comments</label>
              <p className="comments-text-display">{formData.comments}</p>
            </div>
          )}

          {/* Delivery Document multiple files */}
          {existingDocuments.length > 0 && (
            <div className="document-vault-section mt-15">
              <h4 className="vault-group-title">Delivery Documents</h4>
              <div className="payment-receipts-gallery-grid">
                {existingDocuments.map((docUrl, i) => (
                  <a key={i} href={docUrl} target="_blank" rel="noopener noreferrer" className="receipt-gallery-item-card">
                    {renderDocumentPreview(docUrl, null, "PDF Receipt")}
                  </a>
                ))}
              </div>
            </div>
          )}

          {existingImages.length > 0 && (
            <div className="document-vault-section mt-15">
              <h4 className="vault-group-title">Delivery Photos</h4>
              <div className="payment-receipts-gallery-grid">
                {existingImages.map((imgUrl, i) => (
                  <a key={i} href={imgUrl} target="_blank" rel="noopener noreferrer" className="receipt-gallery-item-card">
                    <img src={imgUrl} alt={`delivery-proof-${i}`} className="gallery-thumbnail-element" />
                  </a>
                ))}
              </div>
            </div>
          )}
          
          <div className="workspace-action-trigger-row center-aligned-row mt-25">
            {canUpdate && (
              <button type="button" className="btn-action-edit" onClick={() => { setDeliveryDateInput(""); setIsEditing(true); }}>
                <FaEdit /> Edit Details
              </button>
            )}
          </div>
        </div>
      )}

      {/* EDITING MODE CONTAINER INTERFACES FOR GENERAL TAB */}
      {activeTab === "general" && isEditing && (
        <div className="interactive-form-workspace edit-mode-panel">
          <h3 className="workspace-pane-title" style={{ marginBottom: "20px" }}>
             Edit Delivery Details
          </h3>
          <div className="form-grid-layout">
            <div className="form-group-element">
              <label>Delivery Date</label>
              <input
                type="date"
                name="delivery_date_input"
                value={deliveryDateInput}
                onChange={(e) => canUpdate && setDeliveryDateInput(e.target.value)}
                disabled={!canUpdate}
              />
              {formData.delivery_date && (
                <p className="field-note" style={{ fontSize: "9px" }}>
                  Currently saved: {formatISOToDMY(formData.delivery_date)}. Leave blank to keep it.
                </p>
              )}
            </div>
            <div className="form-group-element">
              <label>Delivered By</label>
              <input type="text" name="delivered_by" value={formData.delivered_by} onChange={handleInputChange} disabled={!canUpdate} placeholder="Transporter name" />
            </div>
            <div className="form-group-element">
              <label>Received By</label>
              <input type="text" name="received_by" value={formData.received_by} onChange={handleInputChange} disabled={!canUpdate} placeholder="Receiver name" />
            </div>
          </div>

          <div className="vault-uploader-block mt-16 vault-uploader-block--white">
            <h4 className="vault-group-title">DELIVERY CHECKLIST</h4>
            <div className="form-grid-layout pt-8">
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="electrical_delivered" checked={formData.electrical_delivered} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Electrical Materials</span>
              </label>
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="structure_delivered" checked={formData.structure_delivered} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Structure Materials</span>
              </label>
              <label className="kseb-checkbox-custom-label">
                <input type="checkbox" name="panel_delivered" checked={formData.panel_delivered} onChange={handleInputChange} disabled={!canUpdate} />
                <span className="kseb-checkbox-text">Solar Panel</span>
              </label>
            </div>
          </div>

          <div className="form-grid-layout mt-16">
            <div className="form-group-element textarea-full-span">
              <label>Changes (read only)</label>
              <p className="field-note" style={{fontSize:"9px"}}>* it can only be edited during site visit</p>
              <textarea name="site_visit_changes" value={siteVisitChanges} rows="2" disabled readOnly />
            </div>
            <div className="form-group-element textarea-full-span">
              <label>Comments </label>
              <textarea name="comments" value={formData.comments} onChange={handleInputChange} rows="2" disabled={!canUpdate} />
            </div>
          </div>

          <div className="vault-uploader-block mt-16 vault-uploader-block--white">
            <label>Upload Delivery Documents</label>
            <div className="payment-uploader-flex-row vertical-stack-previews">

              <input type="file" accept="image/*,.pdf" multiple onChange={handleDocumentSelect} disabled={!canUpdate} />

              {(existingDocuments.length > 0 || newDocumentFiles.length > 0) && (
                <div style={{ width: "100%", marginTop: "12px" }}>
                  <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", display: "block", marginBottom: "6px" }}>
                    Uploaded Documents & Previews:
                  </span>

                  <div className="payment-receipts-gallery-grid">
                    {existingDocuments.map((url, i) => (
                      <div key={`exdoc-${i}`} className="receipt-tile-container">
                        {renderDocumentPreview(url, null)}
                        <button type="button" onClick={() => handleRemoveExistingDocument(url)} disabled={!canUpdate} className="tile-floating-remove-btn">
                          <FaTimes />
                        </button>
                      </div>
                    ))}

                    {newDocumentFiles.map((file, i) => (
                      <div key={`lodoc-${i}`} className="receipt-tile-container">
                        {renderDocumentPreview(file, newDocumentPreviews[i])}
                        <button type="button" onClick={() => handleRemoveNewDocument(i)} disabled={!canUpdate} className="tile-floating-remove-btn">
                          <FaTimes />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>

          <div className="vault-uploader-block mt-16 vault-uploader-block--white">
            <h4 className="vault-group-title">Attach Delivery Images</h4>
            <input type="file" multiple accept="image/*" onChange={handleImageSelect} disabled={!canUpdate} className="vault-raw-file-selector" />
            <div className="interactive-gallery-preview-deck mt-12">
              {existingImages.map((url, i) => (
                <div key={`ex-${i}`} className="gallery-preview-wrapper-node">
                  <img src={url} alt="cloud repository asset" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveExistingImage(url)}>✖</button>
                </div>
              ))}
              {imagePreviews.map((blobUrl, i) => (
                <div key={`lo-${i}`} className="gallery-preview-wrapper-node">
                  <img src={blobUrl} alt="local staging snapshot" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveNewImage(i)}>✖</button>
                </div>
              ))}
            </div>
          </div>

          <div className="center-aligned-row mt-30 gap-16">
            <button type="button" className="btn-action-edit" onClick={handleSaveClick}>
              Save Changes
            </button>
            <button type="button" className="btn-action-cancel" onClick={handleCancelEditClick}>
              Cancel
            </button>
          </div>
        </div>
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

export default MaterialDelivery;