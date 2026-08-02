import React, { useState, useEffect } from "react";
import { FaLock, FaPaperPlane, FaEdit, FaTrashAlt, FaCloudUploadAlt, FaEye, FaTimes } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext"; // <-- Hooks into the global state context layer

const formatDate = (value) => {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch {
    return value;
  }
};

const buildPartsArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (value.trim().startsWith("[") && value.trim().endsWith("]")) {
      try {
        return JSON.parse(value);
      } catch {
        // Fall through
      }
    }
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const Services = ({ customerId, customer }) => {
  // Pull core state matrix variables directly from the Global Context Memory Map
  const { permissions, refetchPermissions, isAdmin, role } = useAuth();
  const isUserAdmin = isAdmin || role === "admin";
  
  // Resolve module permissions directly from the central registry matrix schema
  const access = permissions["Service"] || { view: false, create: false, update: false, delete: false };

  // Component operational tracking states
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState({});
  const [serviceList, setServiceList] = useState([]);
  const [sortBy, setSortBy] = useState("created_asc");
  const [serviceEdit, setServiceEdit] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [removedPhotos, setRemovedPhotos] = useState([]);
  const [expandedService, setExpandedService] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const [formData, setFormData] = useState({
    service_date: "",
    service_type: "Maintenance",
    technician_name: "",
    complaint_issue: "",
    system_status: "Operational",
    parts_replaced: "",
    next_service_due: "",
    comments: ""
  });

  const pendingRequestsStorageKey = customerId ? `service_pending_requests_${customerId}` : null;

  const updatePendingRequestsCache = (requests) => {
    setPendingRequests(requests);
    if (pendingRequestsStorageKey) {
      if (Object.keys(requests).length) {
        localStorage.setItem(pendingRequestsStorageKey, JSON.stringify(requests));
      } else {
        localStorage.removeItem(pendingRequestsStorageKey);
      }
    }
  };

  const fetchAccessRequests = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/service/check-access/`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (response.ok) {
        const data = await response.json();
        const requests = data.pending_requests || {};
        updatePendingRequestsCache(requests);
        if (data.view || isUserAdmin) {
          fetchServiceDataset();
        }
      }
    } catch (err) {
      console.error("Failed to load service access state", err);
    }
  };

  useEffect(() => {
    if (!customerId) return;

    const cachedPending = pendingRequestsStorageKey ? localStorage.getItem(pendingRequestsStorageKey) : null;
    if (cachedPending) {
      try {
        setPendingRequests(JSON.parse(cachedPending));
      } catch {
        localStorage.removeItem(pendingRequestsStorageKey);
      }
    }

    fetchAccessRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Automatically pull datasets when page sorting options or customer target indexes change
  useEffect(() => {
    if (access.view || isUserAdmin) {
      fetchServiceDataset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, access.view, isUserAdmin, sortBy]);

  const fetchServiceDataset = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/service/project/${customerId}/?sort_by=${sortBy}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      if (response.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user_role");
        window.location.reload();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setServiceList(data.services || []);
      } else {
        setServiceList([]);
      }
    } catch (err) {
      console.error("Failed to load service records", err);
      setServiceList([]);
    } finally {
      setLoading(false);
    }
  };

  const resetFormState = () => {
    photoPreviews.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error("Error revoking object URL", e);
      }
    });

    setFormData({
      service_date: "",
      service_type: "Maintenance",
      technician_name: "",
      complaint_issue: "",
      system_status: "Operational",
      parts_replaced: "",
      next_service_due: "",
      comments: ""
    });
    setEditingService(null);
    setSelectedPhotos([]);
    setPhotoPreviews([]);
    setExistingPhotos([]);
    setRemovedPhotos([]);
  };

 // Service module-il access request cheyyumpol pending status show cheyyanulla changes:

const handleRequestAccessSubmit = async (permissionType) => {
 setRequestLoading(true);
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/service/request-access/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`
      },
      body: JSON.stringify({ permission_type: permissionType })
    });

    if (response.ok) {
      const res = await response.json();
      setPendingRequests((prev) => ({
        ...prev,
        [permissionType]: "Pending"
      }));

      if (refetchPermissions) {
        await refetchPermissions();
      }
      await fetchAccessRequests();
      alert(res.message);
    } else {
      const errorDetails = await response.json().catch(() => ({}));
      alert(errorDetails.error || "Failed to submit permission request.");
    }
  } catch (err) {
    console.error("Access request error", err);
  } finally {
    setRequestLoading(false);
  }
};

  const handleInputChange = (e) => {
    if (!access.update) return;
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoArrayChange = (e) => {
    if (!access.update) return;
    const files = Array.from(e.target.files);
    setSelectedPhotos((prev) => [...prev, ...files]);
    const newPreviews = files.map((file) => URL.createObjectURL(file));
    setPhotoPreviews((prev) => [...prev, ...newPreviews]);
  };

  const handleRemoveNewPhoto = (index) => {
    if (!access.update) return;
    if (photoPreviews[index]) {
      URL.revokeObjectURL(photoPreviews[index]);
    }
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExistingPhoto = (index, url) => {
    if (!access.update) return;
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
    setRemovedPhotos((prev) => [...prev, url]);
  };

  const openCreateForm = () => {
    resetFormState();
    setServiceEdit(true);
  };

  const openEditForm = (service) => {
    setEditingService(service);
    
    let rawParts = "";
    if (service.parts_replaced) {
      if (Array.isArray(service.parts_replaced)) {
        rawParts = service.parts_replaced.join(", ");
      } else if (typeof service.parts_replaced === "string") {
        if (service.parts_replaced.trim().startsWith("[") && service.parts_replaced.trim().endsWith("]")) {
          try {
            const parsed = JSON.parse(service.parts_replaced);
            rawParts = Array.isArray(parsed) ? parsed.join(", ") : service.parts_replaced;
          } catch {
            rawParts = service.parts_replaced;
          }
        } else {
          rawParts = service.parts_replaced;
        }
      }
    }

    let parsedImages = [];
    if (service.images) {
      if (Array.isArray(service.images)) {
        parsedImages = service.images;
      } else if (typeof service.images === "string") {
        try {
          parsedImages = JSON.parse(service.images);
        } catch {
          parsedImages = [];
        }
      }
    }

    setFormData({
      service_date: service.service_date ? service.service_date.split("T")[0] : "",
      service_type: service.service_type || "Maintenance",
      technician_name: service.technician_name || "",
      complaint_issue: service.complaint_issue || "",
      system_status: service.system_status || "Operational",
      parts_replaced: rawParts,
      next_service_due: service.next_service_due ? service.next_service_due.split("T")[0] : "",
      comments: service.comments || ""
    });
    
    setExistingPhotos(parsedImages);
    setSelectedPhotos([]);
    setPhotoPreviews([]);
    setRemovedPhotos([]);
    setServiceEdit(true);
  };

  const triggerSaveConfirmation = (e) => {
    e.preventDefault();
    if (!access.update) {
      alert("Operational Guardrail: Security matrix context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: editingService ? "Update Service Record" : "Save Service Record",
      message: editingService
        ? "Are you sure you want to update this service record?"
        : "Are you sure you want to save this service record?",
      onConfirm: () => {
        executeFormSubmission();
      }
    });
  };

  const executeFormSubmission = async () => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);

    const submitPayload = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      if (key === "parts_replaced") {
        submitPayload.append("parts_replaced", JSON.stringify(buildPartsArray(value)));
      } else {
        // Always send the field, even when empty — otherwise the update
        // endpoint's "if field in request.form" check never sees it and
        // an intentionally-cleared value (e.g. next_service_due) never saves.
        submitPayload.append(key, value);
      }
    });

    selectedPhotos.forEach((file) => {
      submitPayload.append("images", file);
    });

    if (removedPhotos.length) {
      submitPayload.append("removed_images", JSON.stringify(removedPhotos));
    }

    try {
      const endpoint = editingService
        ? `${import.meta.env.VITE_API_BASE_URL}/api/service/update/${editingService.id}/`
        : `${import.meta.env.VITE_API_BASE_URL}/api/service/${customerId}/`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: submitPayload
      });

      if (response.ok) {
        setServiceEdit(false);
        resetFormState();
        fetchServiceDataset();
      } else {
        const errorDetails = await response.json().catch(() => ({}));
        alert(errorDetails.error || "Failed to save service record.");
      }
    } catch (err) {
      console.error("Service save error", err);
    } finally {
      setLoading(false);
    }
  };

  const triggerDeleteConfirmation = (service) => {
    setModalConfig({
      isOpen: true,
      title: "Delete Service Record",
      message: "Are you sure you want to delete this service log?",
      onConfirm: () => deleteService(service.id)
    });
  };

  // Backend: admins bypass check_permission entirely regardless of the matrix,
  // and non-admins need an explicit 'delete' grant (never implied by 'update').
  const canDeleteService = isUserAdmin || access.delete;

  const deleteService = async (serviceId) => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/service/${serviceId}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      if (response.ok) {
        fetchServiceDataset();
      } else {
        const errorDetails = await response.json().catch(() => ({}));
        alert(errorDetails.error || "Failed to delete service record.");
      }
    } catch (err) {
      console.error("Service delete error", err);
    } finally {
      setLoading(false);
    }
  };

  const getRenderablePartsList = (partsField) => {
    return buildPartsArray(partsField);
  };

  const getRenderableImagesList = (imagesField) => {
    if (!imagesField) return [];
    if (Array.isArray(imagesField)) return imagesField;
    try {
      return JSON.parse(imagesField);
    } catch {
      return [];
    }
  };

  // Render Authentication Entry locking box structure if global matrix matrix schema criteria blocks visibility switches
  // NOTE (fix): admins bypass permission checks entirely on the backend, but
  // `access` here only reflects permissions["Service"], which can still be
  // {view: false} on the very first render (before the permissions map has
  // loaded). That briefly flashed the "Access Restricted / Request Access"
  // screen for admins too. Admins should never see this gate, so short-circuit
  // it with isUserAdmin - the normal `loading` spinner below covers the wait.
  if (!isUserAdmin && !access.view) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the Service & Maintenance module.</p>
          {pendingRequests["view"] ? (
            <div className="sitevisit-alert-success-banner">⚠️ View Request Pending Approval</div>
          ) : (
            <button
              type="button"
              className="request-access-trigger-btn"
              onClick={() => handleRequestAccessSubmit("view")}
              disabled={requestLoading}
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
      {loading && (
        <div className="sitevisit-loading-overlay">
          <div className="table-spinner"></div>
          Loading...
        </div>
      )}

      {!serviceEdit ? (
        <div className="site-details-deck">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>Service & Maintenance </h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {!access.update && (
                pendingRequests["update"] ? (
                  <button type="button" className="request-permission-inline-btn" disabled style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", padding: "4px 8px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "4px", color: "#94a3b8", cursor: "not-allowed" }}>
                    ⚠️ {pendingRequests["update"]}
                  </button>
                ) : (
                  <button type="button" className="request-permission-inline-btn" onClick={() => handleRequestAccessSubmit("update")} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", padding: "4px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", color: "#475569" }}>
                    <FaPaperPlane size={10} /> Request Update Authorization
                  </button>
                )
              )}
              {access.update && (
                <button type="button" className="btn-action-edit" onClick={openCreateForm}>
                  + Add Service Record
                </button>
              )}
            </div>
          </div>

          <div className="sort-container-wrapper">
            <label htmlFor="service-sort-by">
              Sort By:
            </label>
            <select
              id="service-sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-by-select"
            >
              <option value="created_desc">Newest Created</option>
              <option value="created_asc">Oldest Created</option>
              <option value="updated_desc">Last Modified (Newest First)</option>
              <option value="updated_asc">Last Modified (Oldest First)</option>
            </select>
          </div>

          {serviceList.length > 0 ? (
            <div className="detail-data-grid">
              {serviceList.map((service) => {
                const parts = getRenderablePartsList(service.parts_replaced);
                const images = getRenderableImagesList(service.images);

                return (
                  <div key={service.id} className="service-card">
                    <div className="service-card-header">
                      <div>
                        <span className="service-card-number" style={{ display: "block", fontWeight: 700, fontSize: "0.8rem", color: "#64748b", letterSpacing: "0.03em",marginBottom: "10px" }}>
                          Service #{service.service_number ?? "—"}
                        </span>
                        <h4 className="service-card-title" style={{ margin: 0 }}>{service.service_type || "Service"}</h4>
                      </div>
                      <div className="service-card-actions">
                        <button
                          type="button"
                          className="btn-action-view"
                          onClick={() => setExpandedService(service)}
                          title="View full details"
                          style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", color: "#334155" }}
                        >
                          <FaEye />
                        </button>
                        {access.update && (
                          <button type="button" className="btn-action-edit" onClick={() => openEditForm(service)}>
                            <FaEdit />
                          </button>
                        )}
                        {canDeleteService && (
                          <button type="button" className="btn-action-delete" onClick={() => triggerDeleteConfirmation(service)} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <FaTrashAlt /> 
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="service-card-body">
                      <p className="service-field"><strong>Date:</strong> {formatDate(service.service_date)}</p>
                      <p className="service-field"><strong>Technician:</strong> {service.technician_name || "N/A"}</p>
                      <p className="service-field"><strong>Status:</strong> {service.system_status || "N/A"}</p>
                      <p className="service-field service-field-complaint"><strong>Complaint:</strong> {service.complaint_issue || "No complaint noted"}</p>
                      {parts.length > 0 && (
                        <p className="service-field"><strong>Parts:</strong> {parts.join(", ")}</p>
                      )}
                    </div>

                    
                      <div className="service-card-comments">
                        <label className="narrative-label">Comments</label>
                        <p>{service.comments}</p>
                      </div>
                    

                    <div className="service-card-gallery">
                      <h5>Images</h5>
                      {images.length > 0 ? (
                        <div className="service-gallery-grid">
                          {images.map((img, index) => (
                            <a key={`${service.id}-${index}`} href={img} target="_blank" rel="noreferrer" className="gallery-thumbnail-wrapper">
                              <img src={img} alt={`service-${service.id}-${index}`} className="gallery-thumbnail-element" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="service-gallery-empty">No images uploaded</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-record-placeholder-tray centered-placeholder-box" style={{ padding: "40px 20px" }}>
              <p className="placeholder-primary-msg" style={{ marginBottom: "15px" }}>No service records have been added yet for this customer.</p>
              {!access.update && (
                pendingRequests["update"] ? (
                  <div className="sitevisit-alert-success-banner">⚠️ Update Request Pending Approval</div>
                ) : (
                  <button
                    type="button"
                    className="request-access-trigger-btn"
                    onClick={() => handleRequestAccessSubmit("update")}
                    disabled={requestLoading}
                  >
                    Request Update Authorization
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={triggerSaveConfirmation} className="interactive-form-workspace">
          <h2 className="workspace-pane-title">
            {editingService ? `Edit Service Record — Service #${editingService.service_number ?? "—"}` : "Add New Service Record"}
          </h2>

          <div className="form-grid-layout">
            <div className="form-group-element">
              <label>Service Date *</label>
              <input type="date" name="service_date" value={formData.service_date} onChange={handleInputChange} disabled={!access.update} required />
            </div>
            <div className="form-group-element">
              <label>Service Type *</label>
              <select name="service_type" value={formData.service_type} onChange={handleInputChange} disabled={!access.update} required>
                <option value="Maintenance">Maintenance</option>
                <option value="Repair">Repair</option>
                <option value="Inspection">Inspection</option>
              </select>
            </div>
            <div className="form-group-element">
              <label>Technician Name</label>
              <input type="text" name="technician_name" value={formData.technician_name} onChange={handleInputChange} disabled={!access.update} />
            </div>
            <div className="form-group-element">
              <label>System Status</label>
              <select name="system_status" value={formData.system_status} onChange={handleInputChange} disabled={!access.update}>
                <option value="Operational">Normal</option>
                <option value="Faulty">Faulty</option>
                <option value="Needs Attention">Needs Attention</option>
              </select>
            </div>
          </div>

          <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
            <label>Complaint / Issue</label>
            <textarea name="complaint_issue" value={formData.complaint_issue} onChange={handleInputChange} disabled={!access.update} rows="3" />
          </div>

          <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
            <label>Parts Replaced</label>
            <textarea name="parts_replaced" value={formData.parts_replaced} onChange={handleInputChange} disabled={!access.update} rows="3" placeholder="e.g. Inverter, Battery" />
          </div>

          {/* <div className="form-group-element" style={{ marginTop: "16px" }}>
            <label>Next Service Due</label>
            <input type="date" name="next_service_due" value={formData.next_service_due} onChange={handleInputChange} disabled={!access.update}  readOnly/>
          </div> */}

          <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
            <label>Comments</label>
            <textarea name="comments" value={formData.comments} onChange={handleInputChange} disabled={!access.update} rows="3" />
          </div>

          <div className="vault-uploader-block" style={{ marginTop: "16px" }}>
            <h4 className="vault-group-title">Service Images</h4>
            <div className="form-group-element multi-file-zone-pad">
              <input type="file" multiple accept="image/*" className="vault-raw-file-selector" onChange={handlePhotoArrayChange} disabled={!access.update} />
            </div>

            <div className="interactive-gallery-preview-deck">
              {photoPreviews.map((blobUrl, index) => (
                <div key={`local-${index}`} className="gallery-preview-wrapper-node">
                  <img src={blobUrl} alt="local preview" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveNewPhoto(index)} disabled={!access.update}>✖</button>
                </div>
              ))}
              {existingPhotos.map((url, index) => (
                <div key={`exist-${index}`} className="gallery-preview-wrapper-node">
                  <img src={url} alt="cloud storage asset" />
                  <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveExistingPhoto(index, url)} disabled={!access.update}>✖</button>
                </div>
              ))}
            </div>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
            {access.update && <button type="submit" className="btn-action-edit">Save Service Record</button>}
            <button
              type="button"
              className="btn-action-cancel"
              onClick={() => {
                setServiceEdit(false);
                resetFormState();
              }}
            >
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

      {expandedService && (
        <div
          className="service-zoom-overlay"
          onClick={() => setExpandedService(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px"
          }}
        >
          <div
            className="service-zoom-box"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              background: "#fff",
              borderRadius: "16px",
              width: "min(900px, 95vw)",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "40px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
              fontSize: "1.15rem",
              lineHeight: 1.6
            }}
          >
            <button
              type="button"
              onClick={() => setExpandedService(null)}
              title="Close"
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: "50%",
                width: "40px",
                height: "40px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "1.1rem",
                color: "#334155"
              }}
            >
              <FaTimes />
            </button>

            <span style={{ display: "block", fontWeight: 700, fontSize: "1rem", color: "#64748b", letterSpacing: "0.03em", marginBottom: "8px" }}>
              Service #{expandedService.service_number ?? "—"}
            </span>
            <h2 style={{ margin: "0 0 24px 0", fontSize: "1.8rem" }}>{expandedService.service_type || "Service"}</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 32px", marginBottom: "24px" }}>
              <p style={{ margin: 0, fontSize: "1.15rem" }}><strong>Date:</strong> {formatDate(expandedService.service_date)}</p>
              <p style={{ margin: 0, fontSize: "1.15rem" }}><strong>Technician:</strong> {expandedService.technician_name || "N/A"}</p>
              <p style={{ margin: 0, fontSize: "1.15rem" }}><strong>Status:</strong> {expandedService.system_status || "N/A"}</p>
              <p style={{ margin: 0, fontSize: "1.15rem" }}><strong>Next Service Due:</strong> {formatDate(expandedService.next_service_due)}</p>
            </div>

            <p style={{ fontSize: "1.15rem" }}><strong>Complaint:</strong> {expandedService.complaint_issue || "No complaint noted"}</p>

            {getRenderablePartsList(expandedService.parts_replaced).length > 0 && (
              <p style={{ fontSize: "1.15rem" }}><strong>Parts:</strong> {getRenderablePartsList(expandedService.parts_replaced).join(", ")}</p>
            )}

            {expandedService.comments && (
              <div style={{ marginTop: "20px" }}>
                <label className="narrative-label" style={{ fontSize: "1rem", fontWeight: 700 }}>Comments</label>
                <p style={{ fontSize: "1.15rem" }}>{expandedService.comments}</p>
              </div>
            )}

            <div style={{ marginTop: "28px" }}>
              <h5 style={{ fontSize: "1.25rem", marginBottom: "14px" }}>Images</h5>
              {getRenderableImagesList(expandedService.images).length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "18px" }}>
                  {getRenderableImagesList(expandedService.images).map((img, index) => (
                    <a key={`zoom-${expandedService.id}-${index}`} href={img} target="_blank" rel="noreferrer">
                      <img
                        src={img}
                        alt={`service-${expandedService.id}-${index}`}
                        style={{ width: "100%", height: "220px", objectFit: "cover", borderRadius: "10px", border: "1px solid #e2e8f0" }}
                      />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="service-gallery-empty" style={{ fontSize: "1.1rem" }}>No images uploaded</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Services;