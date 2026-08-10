import React, { useState, useEffect, useMemo, useRef } from "react";
  // add map location icon
  import { FaLock, FaCloudUploadAlt, FaEye, FaMapMarkerAlt, FaFilePdf, FaTrashAlt, FaEdit, FaPaperPlane, } from "react-icons/fa";
  import { FaLocationCrosshairs } from "react-icons/fa6";
  import ConfirmationModal from "../components/ConfirmationModal"; 
  import { useAuth } from "../context/AuthContext";

  const getGoogleMapsUrl = (location) => {
    if (!location) return "#";
    const targetLocation = location.includes(" | ") ? location.split(" | ")[0] : location;
    // return `http://googleusercontent.com/maps.google.com/?q=${encodeURIComponent(targetLocation)}`;
    return `https://maps.google.com/?q=${encodeURIComponent(targetLocation)}`;
  };

  const getPdfPreviewUrl = (path) => {
    if (!path) return "#";
    if (path.toLowerCase().endsWith('.pdf') || path.includes('/raw/upload/')) {
      return `https://docs.google.com/gview?url=${encodeURIComponent(path)}&embedded=true`;
    }
    return path;
  };

  // Hoisted so this array literal isn't rebuilt (and re-mapped) on every render
  const VERIFICATION_DOC_KEYS = ["aadhaar", "pan", "kseb_bill", "bank_passbook", "land_tax", "building_tax", "signature"];

  const SiteVisit = ({ customerId, customer }) => {
    const { permissions, refetchPermissions, isAdmin, role } = useAuth();
    
    const modulePermissions = useMemo(
      () => permissions["Site Visit"] || permissions["SiteVisit"] || { view: false, create: false, update: false, delete: false },
      [permissions]
    );
    const canView = isAdmin || role === 'admin' || modulePermissions.view;
    const canUpdate = isAdmin || role === 'admin' || modulePermissions.update;

    const [loading, setLoading] = useState(true);
    const [locationLoading, setLocationLoading] = useState(false);
    const [siteEdit, setSiteEdit] = useState(false);
    const [visitData, setVisitData] = useState(null);
    const [pendingRequests, setPendingRequests] = useState({});
    const [accessDenied, setAccessDenied] = useState(false);
    const [requestLoading, setRequestLoading] = useState(false);

    const [modalConfig, setModalConfig] = useState({
      isOpen: false,
      title: "",
      message: "",
      onConfirm: () => {}
    });

    const [selectedPhotos, setSelectedPhotos] = useState([]);
    const [photoPreviews, setPhotoPreviews] = useState([]);
    const [existingPhotos, setExistingPhotos] = useState([]);
    const [removedPhotos, setRemovedPhotos] = useState([]);
    const [documentFiles, setDocumentFiles] = useState({});

    const [formData, setFormData] = useState({
      panel_capacity: "",
      system_capacity: customer?.capacity_kw != null && customer.capacity_kw !== "" ? String(customer.capacity_kw) : "",
      feasibility: "Yes",
      project_cost: "",
      location: "",
      comments: "",
      ownership_change: "No",
      load_enhancement: "No",
      wifi: "No",
      changes: "",
      visited_date: ""
    });

    useEffect(() => {
      if (customerId) {
        fetchAccessRequests();
      }
    }, [customerId]);

    // Blob URLs created by URL.createObjectURL() are never garbage collected on their
    // own — revoke them on unmount so we don't leak memory across visits to this page.
    const photoPreviewsRef = useRef(photoPreviews);
    photoPreviewsRef.current = photoPreviews;
    useEffect(() => {
      return () => {
        photoPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      };
    }, []);

    const fetchAccessRequests = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/site-visit/check-access/`, {
          headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.pending_requests) {
            setPendingRequests(data.pending_requests);
          }
          if (data.view || canView) {
            setAccessDenied(false);
            fetchSiteVisitDataset();
          } else {
            setAccessDenied(true);
          }
        } else if (res.status === 403) {
          setAccessDenied(true);
        }
      } catch (err) {
        console.error('Failed to check access privileges:', err);
        if (!canView) setAccessDenied(true);
      }
    };

    const fetchSiteVisitDataset = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/site-visit/${customerId}/`, {
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
          if (data.visit) {
            setVisitData(data.visit);
            setFormData({
              panel_capacity: data.visit.panel_capacity !== undefined ? String(data.visit.panel_capacity) : "",
              system_capacity: data.visit.system_capacity !== undefined ? String(data.visit.system_capacity) : "",
              feasibility: data.visit.feasibility || "Yes",
              project_cost: data.visit.project_cost !== undefined ? String(data.visit.project_cost) : "",
              location: data.visit.location || "",
              comments: data.visit.comments || "",
              ownership_change: data.visit.ownership_change || "No",
              load_enhancement: data.visit.load_enhancement || "No",
              wifi: data.visit.wifi || "No",
              changes: data.visit.changes || "",
              visited_date: data.visit.visited_date || ""
            });
            setExistingPhotos(data.visit.images || []);
          } else {
            resetFormDataState();
          }
        } else {
          resetFormDataState();
        }
      } catch (err) {
        console.error("Failed to recover site data block", err);
        resetFormDataState();
      } finally {
        setLoading(false);
      }
    };

    const resetFormDataState = () => {
      setVisitData(null);
      // No SiteVisit row exists yet for this customer (e.g. capacity_kw was
      // only set at customer-creation time, which deliberately does not
      // create a SiteVisit row — see backend comments in customers.py).
      // Prefill System Capacity from the customer's capacity_kw so it isn't
      // shown as blank when we already know the value.
      const prefillCapacity = customer?.capacity_kw != null && customer.capacity_kw !== ""
        ? String(customer.capacity_kw)
        : "";
      setFormData({
        panel_capacity: "",
        system_capacity: prefillCapacity,
        feasibility: "Yes",
        project_cost: "",
        location: "",
        comments: "",
        ownership_change: "No",
        load_enhancement: "No",
        wifi: "No",
        changes: "",
        visited_date: ""
      });
      setExistingPhotos([]);
    };

    const handleRequestAccessSubmit = async (permissionType) => {
      setRequestLoading(true);
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/site-visit/request-access/`, {
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
          alert(res.message || "Access request submitted successfully.");
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
      setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleCheckboxChange = (name, checked) => {
      if (!canUpdate) return;
      setFormData((prev) => ({ ...prev, [name]: checked ? "Yes" : "No" }));
    };

    const handleLocationAutoFill = async () => {
      if (!canUpdate || !navigator.geolocation || locationLoading) return;
      setLocationLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            const gpsCoordinates = `${latitude},${longitude}`;
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
            );
            const data = await response.json();
            const addressDetails = data?.address || {};
            const locationName = [
              addressDetails?.road,
              addressDetails?.suburb,
              addressDetails?.city || addressDetails?.town || addressDetails?.village
            ].filter(Boolean).join(", ") || "Detected Location";

            setFormData((prev) => ({
              ...prev,
              location: `${gpsCoordinates} | ${locationName}`,
            }));
          } catch (error) {
            console.error("Location fetch failed:", error);
          } finally {
            setLocationLoading(false);
          }
        },
        (error) => {
          console.error("Geolocation error:", error);
          setLocationLoading(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    };

    const handlePhotoArrayChange = (e) => {
      if (!canUpdate) return;
      const files = Array.from(e.target.files);
      setSelectedPhotos((prev) => [...prev, ...files]);
      const newPreviews = files.map((file) => URL.createObjectURL(file));
      setPhotoPreviews((prev) => [...prev, ...newPreviews]);
    };

    const handleDocumentChange = (e) => {
      if (!canUpdate) return;
      const { name, files } = e.target;
      if (files && files[0]) {
        setDocumentFiles((prev) => ({ ...prev, [name]: files[0] }));
      }
    };

    const handleRemoveNewPhoto = (index) => {
      if (!canUpdate) return;
      setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
      setPhotoPreviews((prev) => {
        const removedUrl = prev[index];
        if (removedUrl) URL.revokeObjectURL(removedUrl);
        return prev.filter((_, i) => i !== index);
      });
    };

    const handleRemoveExistingPhoto = (index, url) => {
      if (!canUpdate) return;
      setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
      setRemovedPhotos((prev) => [...prev, url]);
    };

    const triggerSaveConfirmation = (e) => {
      e.preventDefault();
      if (!canUpdate) {
        alert("Operational Guardrail: Security context lacks required update clearance parameters.");
        return;
      }
      setModalConfig({
        isOpen: true,
        title: "Save Changes",
        message: "Are you sure you want to save this site visit data?",
        onConfirm: () => {
          executeFormSubmission();
        }
      });
    };

    const executeFormSubmission = async () => {
      setModalConfig((prev) => ({ ...prev, isOpen: false }));
      setLoading(true);
      
      const submitPayload = new FormData();
      Object.keys(formData).forEach((key) => {
        if (key !== "images") {
          submitPayload.append(key, formData[key]);
        }
      });

      selectedPhotos.forEach((file) => {
        submitPayload.append("images", file);
      });

      Object.keys(documentFiles).forEach((fieldKey) => {
        submitPayload.append(fieldKey, documentFiles[fieldKey]);
      });

      submitPayload.append("removed_images", JSON.stringify(removedPhotos));

      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/site-visit/${customerId}/`, {
          method: "PUT",
          headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
          body: submitPayload
        });
        if (response.ok) {
          setSiteEdit(false);
          setSelectedPhotos([]);
          photoPreviews.forEach((url) => URL.revokeObjectURL(url));
          setPhotoPreviews([]);
          setRemovedPhotos([]);
          setDocumentFiles({});
          fetchSiteVisitDataset();
        } else {
          const errorDetails = await response.json();
          alert(errorDetails.error || "Failed to save data.");
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
            <p>You don't have permission to access the Site Visit metrics dashboard.</p>
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

        {!siteEdit ? (
          <div className="site-details-deck">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "15px" }}>
              <h2 className="workspace-pane-title" style={{ margin: 0 }}>Site Visit Details</h2>
              <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
                {visitData && !canUpdate && (
                  pendingRequests["update"] === "Pending" ? (
                    <span style={{ fontSize: "0.8rem", color: "#ca8a04", fontWeight: "600" }}>⚠️ Update Request Pending</span>
                  ) : (
                    <button type="button" className="request-permission-inline-btn" onClick={() => handleRequestAccessSubmit("update")} disabled={requestLoading} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", padding: "4px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", color: "#475569" }}>
                      <FaPaperPlane size={10} /> Request Update Authorization
                    </button>
                  )
                )}
              </div>
            </div>
            
            <>
                <div className="detail-data-grid">
                  <div className="detail-item-node">
                    <span className="node-label">Customer Name:</span>
                    {visitData?.customer_name ? (
                      <span className="node-value">{visitData.customer_name}</span>
                    ) : (
                      <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Location Mapping:</span>
                    
                      {visitData?.location ? (
                        <span className="node-value">
                        <a href={getGoogleMapsUrl(visitData.location)} target="_blank" rel="noopener noreferrer" className="maps-hyperlink">
                          <FaMapMarkerAlt style={{ marginRight: "6px" }} />
                          {visitData.location.includes(" | ") ? visitData.location.split(" | ")[1] : "View Map Location"}
                        </a>
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.65rem", color: "#64748b" }}>No location data</span>
                      )}
                    
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Panel Capacity:</span>
                    {visitData?.panel_capacity ? (
                      <span className="node-value">{`${visitData.panel_capacity} KW`}</span>
                    ) : (
                      <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">System Capacity:</span>
                    
                      {visitData?.system_capacity ? (
                        <span className="node-value">
                          {`${visitData.system_capacity} KW`}
                        </span>
                      ) : customer?.capacity_kw ? (
                        <span className="node-value">
                          {`${customer.capacity_kw} KW`}
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                      )}
                   
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Visited Date:</span>
                    {visitData?.visited_date ? (
                      <span className="node-value">{new Date(visitData.visited_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    ) : (
                      <span  style={{ fontSize: "0.65rem", color: "#64748b" }}>dd-mm-yyyy</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Feasibility Status:</span>
                    {visitData?.feasibility ? (
                      <span className="node-value">{visitData.feasibility}</span>
                    ) : (
                      <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Project Cost:</span>
                    {visitData?.project_cost ? (
                      <span className="node-value text-emerald">{`₹${parseFloat(visitData.project_cost).toLocaleString('en-IN')}`}</span>
                    ) : (
                      <span style={{ fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Load Enhancement:</span>
                    {visitData?.load_enhancement === "Yes" ? (
                      <span className="node-value">Yes</span>
                    ) : (
                      <span className="node-value">No</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">Ownership Change:</span>
                    {visitData?.ownership_change === "Yes" ? (
                      <span className="node-value">Yes</span>
                    ) : (
                      <span className="node-value">No</span>
                    )}
                  </div>
                  <div className="detail-item-node">
                    <span className="node-label">WiFi Availability:</span>
                    {visitData?.wifi === "Yes" ? (
                      <span className="node-value">Yes</span>
                    ) : (
                      <span className="node-value">No</span>
                    )}
                  </div>
                </div>

                <div className="text-narrative-block">
                  <label className="narrative-label" style={{color:"#030303"}}>Changes</label>
                  <div className="changes-block"> 
                    <p className="changes-text-display">{visitData?.changes || "No changes recorded."}</p>
                  </div>
                </div>

                <div className="document-vault-section">
                  <h4 className="vault-group-title">Primary Contract Upload</h4>
                  {visitData?.quotation_file || visitData?.agreement_file ? (
                    <div className="custom-box-card">
                      <div className="doc-preview-badge-row">
                        {visitData.quotation_file && (
                          <a href={getPdfPreviewUrl(visitData.quotation_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                            📄 Quotation Scheme
                          </a>
                        )}
                        {visitData.agreement_file && (
                          <a href={getPdfPreviewUrl(visitData.agreement_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                            📄 Formal Agreement
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="empty-record-placeholder-tray layout-margin-top-adjust">
                      <p style={{ fontSize: "0.65rem", color: "#64748b" }}>no files uploaded</p>
                    </div>
                  )}
                </div>

                <div className="document-vault-section">
                  <h4 className="vault-group-title">Verification Documents</h4>
                  {visitData && VERIFICATION_DOC_KEYS.some(docKey => visitData[docKey]) ? (
                    <div className="doc-preview-badge-row">
                      {VERIFICATION_DOC_KEYS.map((docKey) => 
                        visitData[docKey] && (
                          <a key={docKey} href={getPdfPreviewUrl(visitData[docKey])} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                            📄 {docKey.toUpperCase().replace("_", " ")}
                          </a>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="empty-record-placeholder-tray layout-margin-top-adjust">
                      <p style={{ fontSize: "0.65rem", color: "#64748b" }}>no verification documents uploaded</p>
                    </div>
                  )}
                </div>

                <div className="text-narrative-block">
                  <label className="narrative-label">Comments</label>
                  <p className="comments-text-display">{visitData?.comments || "No assessment comments filed."}</p>
                </div>              

                {existingPhotos.length > 0 && (
                  <div className="document-vault-section">
                    <h4 className="vault-group-title">Images</h4>
                    <div className="payment-receipts-gallery-grid">
                      {existingPhotos.map((img, i) => (
                        <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="receipt-gallery-item-card">
                          <img src={img} alt={`site-reference-${i}`} className="gallery-thumbnail-element" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px", gap: "12px" }}>
                  {canUpdate && (
                    <button type="button" className="btn-action-edit" onClick={() => setSiteEdit(true)}>
                      <FaEdit style={{ marginRight: "6px" }} /> Edit Details
                    </button>
                  )}
                </div>
              </>
            
          </div>
        ) : (
          <form onSubmit={triggerSaveConfirmation} className="interactive-form-workspace">
            <h2 className="workspace-pane-title">Edit Site Visit Details</h2>
            
          <div className="form-grid-layout">
    <div className="form-group-element">
      <label>Panel Capacity (KW) *</label>
      <input 
        type="number" 
        name="panel_capacity" 
        step="0.5" 
        min={1}
        value={formData.panel_capacity} 
        onChange={handleInputChange} 
        onWheel={(e) => e.target.blur()} 
        disabled={!canUpdate} 
        required 
      />
    </div>
    <div className="form-group-element">
      <label>System Capacity (KW) *</label>
      <input 
        type="number" 
        name="system_capacity" 
        step="0.5" 
        min={1} 
        value={formData.system_capacity} 
        onChange={handleInputChange} 
        onWheel={(e) => e.target.blur()} 
        disabled={!canUpdate} 
        required 
      />
    </div>
   <div className="form-group-element">
      <label>Visited Date*</label>
      <input
        type="date"
        name="visited_date"
        value={formData.visited_date ? new Date(formData.visited_date).toISOString().split("T")[0] : ""}
        onChange={handleInputChange}
        disabled={!canUpdate}
        required
      />
    </div>

    <div className="form-group-element">
      <label>Structural Feasibility</label>
      <div className="thematic-radio-wrapper-row">
        <label className="radio-option-node">
          <input type="radio" name="feasibility" value="Yes" checked={formData.feasibility === "Yes"} onChange={handleInputChange} disabled={!canUpdate} /> <span>Yes</span>
        </label>
        <label className="radio-option-node">
          <input type="radio" name="feasibility" value="No" checked={formData.feasibility === "No"} onChange={handleInputChange} disabled={!canUpdate} /> <span>No</span>
        </label>
      </div>
    </div>
    <div className="form-group-element">
      <label>Project Cost (₹) *</label>
      <input 
        type="number" 
        name="project_cost" 
        step="0.5" 
        min={0} 
        value={formData.project_cost} 
        onChange={handleInputChange} 
        onWheel={(e) => e.target.blur()} 
        disabled={!canUpdate} 
        required 
      />
    </div>
  </div>

            <div className="vault-uploader-block" style={{ marginTop: "16px" }}>
              <h4 className="vault-group-title">Structural Requirements</h4>
              <div className="form-grid-layout" style={{ paddingTop: "8px" }}>
                <div className="form-group-element">
                  <label className="kseb-checkbox-custom-label">
                    <input
                      type="checkbox"
                      checked={formData.ownership_change === "Yes"}
                      onChange={(e) => handleCheckboxChange("ownership_change", e.target.checked)}
                      disabled={!canUpdate}
                    />
                    <span className="kseb-checkbox-text">Ownership / Name Change Required</span>
                  </label>
                </div>

                <div className="form-group-element">
                  <label className="kseb-checkbox-custom-label">
                    <input
                      type="checkbox"
                      checked={formData.load_enhancement === "Yes"}
                      onChange={(e) => handleCheckboxChange("load_enhancement", e.target.checked)}
                      disabled={!canUpdate}
                    />
                    <span className="kseb-checkbox-text">Load Enhancement Required</span>
                  </label>
                </div>
                <div className="form-group-element">
                  <label className="kseb-checkbox-custom-label">
                    <input
                      type="checkbox"
                      checked={formData.wifi === "Yes"}
                      onChange={(e) => handleCheckboxChange("wifi", e.target.checked)}
                      disabled={!canUpdate}
                    />
                    <span className="kseb-checkbox-text">WiFi Availability</span>
                  </label>
                </div>
              </div>
            </div>
            
            <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
              <label>Changes</label>
              <textarea name="changes" value={formData.changes || ""} onChange={handleInputChange} rows="3" disabled={!canUpdate} />
            </div>

            <div className="form-group-element textarea-full-span" style={{ marginTop: "16px" }}>
              <label>Comments</label>
              <textarea name="comments" value={formData.comments || ""} onChange={handleInputChange} rows="3" disabled={!canUpdate} />
            </div>

            <div className="form-group-element geolocation-broker-box" style={{ marginTop: "16px" }}>
              <label>Location</label>
              <div className="gps-input-compound-field">
                <input name="location" value={formData.location || ""} onChange={handleInputChange} placeholder="GPS Coordinates | Geographic Address String" disabled={!canUpdate} />
                <button type="button" className="gps-auto-trigger-btn" onClick={handleLocationAutoFill} disabled={locationLoading || !canUpdate}>
                  {locationLoading ? <span className="micro-loading-loop"></span> : <FaLocationCrosshairs />}
                </button>
              </div>
            </div>

            <div className="vault-uploader-block" style={{ marginTop: "16px" }}>
              <h4 className="vault-group-title">Primary Contract Upload</h4>
              <div className="form-grid-layout">
                <div className="form-group-element">
                  <label>{visitData?.quotation_file && <span className="vault-upload-status-tick">✓ </span>}Quotation</label>
                  <input type="file" name="quotation_file" accept=".pdf" className="vault-raw-file-selector" onChange={handleDocumentChange} disabled={!canUpdate} />
                </div>
                <div className="form-group-element">
                  <label>{visitData?.agreement_file && <span className="vault-upload-status-tick">✓ </span>}Agreement</label>
                  <input type="file" name="agreement_file" accept=".pdf" className="vault-raw-file-selector" onChange={handleDocumentChange} disabled={!canUpdate} />
                </div>
              </div>
            </div>

            <div className="vault-uploader-block" style={{ marginTop: "16px" }}>
              <h4 className="vault-group-title">Verification Documents</h4>
              <div className="form-grid-layout">
                {VERIFICATION_DOC_KEYS.map((docKey) => (
                  <div className="form-group-element" key={docKey}>
                    <label>{visitData?.[docKey] && <span className="vault-upload-status-tick">✓ </span>}{docKey.toUpperCase().replace("_", " ")}</label>
                    <input type="file" name={docKey} accept="application/pdf, image/*" className="vault-raw-file-selector" onChange={handleDocumentChange} disabled={!canUpdate} />
                  </div>
                ))}
              </div>
            </div>

            <div className="vault-uploader-block" style={{ marginTop: "16px" }}>
              <h4 className="vault-group-title">Images Asset Manager</h4>
              <div className="form-group-element multi-file-zone-pad">
                <input type="file" multiple accept="image/*" className="vault-raw-file-selector" onChange={handlePhotoArrayChange} disabled={!canUpdate} />
              </div>
              
              <div className="interactive-gallery-preview-deck">
                {photoPreviews.map((blobUrl, i) => (
                  <div key={`local-${i}`} className="gallery-preview-wrapper-node">
                    <img src={blobUrl} alt="local preview" />
                    <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveNewPhoto(i)} disabled={!canUpdate}>✖</button>
                  </div>
                ))}
                {existingPhotos.map((url, i) => (
                  <div key={`exist-${i}`} className="gallery-preview-wrapper-node">
                    <img src={url} alt="cloud storage asset" />
                    <button type="button" className="gallery-remove-node-trigger" onClick={() => handleRemoveExistingPhoto(i, url)} disabled={!canUpdate}>✖</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="workspace-action-trigger-row center-aligned-row" style={{ marginTop: "20px" }}>
              {canUpdate && <button type="submit" className="btn-action-edit">Save Changes</button>}
              <button type="button" className="btn-action-cancel" onClick={() => { setSiteEdit(false); setSelectedPhotos([]); photoPreviews.forEach((url) => URL.revokeObjectURL(url)); setPhotoPreviews([]); setRemovedPhotos([]); setDocumentFiles({}); setExistingPhotos(visitData?.images || []); if(visitData) { setFormData({ panel_capacity: String(visitData.panel_capacity), system_capacity: String(visitData.system_capacity), feasibility: visitData.feasibility || "Yes", project_cost: String(visitData.project_cost), location: visitData.location || "", comments: visitData.comments || "", ownership_change: visitData.ownership_change || "No", load_enhancement: visitData.load_enhancement || "No", wifi: visitData.wifi || "No", changes: visitData.changes || "" }); } else { resetFormDataState(); } }}>Cancel</button>
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

  export default SiteVisit;