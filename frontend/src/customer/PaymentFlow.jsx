import React, { useState, useEffect } from "react";
import { FaLock, FaEdit, FaPlus, FaTrash, FaFileAlt, FaCloudUploadAlt, FaTimes, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext"; // <-- Hooks into the global state context layer

const PaymentFlow = ({ customerId }) => {
  // Pull core state matrix variables directly from the Global Context Memory Map
  const { permissions, refetchPermissions, isAdmin, role } = useAuth();
  
  // Resolve module permissions from the central registry matrix using the strict key
  const modulePermissions = permissions["Payment Flow"] || permissions["PaymentFlow"] || { view: false, create: false, update: false };
  const canView = isAdmin || role === 'admin' || modulePermissions.view;
  const canUpdate = isAdmin || role === 'admin' || modulePermissions.update;

  // Component operational tracking states
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState({}); 
  const [accessDenied, setAccessDenied] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Core Financial Data
  const [projectCost, setProjectCost] = useState(0);
  const [loanAmount, setLoanAmount] = useState(0);
  const [paymentData, setPaymentData] = useState(null);

  // Form Workspace States
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceDate, setAdvanceDate] = useState("");
  const [secondPayment, setSecondPayment] = useState("");
  const [secondPaymentDate, setSecondPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [customMethod, setCustomMethod] = useState("");
  const [comments, setComments] = useState("");
  const [additionalPayments, setAdditionalPayments] = useState([]);
  
  // State Arrays for Multiple Upload Handling
  const [proofFiles, setProofFiles] = useState([]);
  const [proofPreviews, setProofPreviews] = useState([]);
  const [existingProofs, setExistingProofs] = useState([]);
  const [removedProofs, setRemovedProofs] = useState([]);

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  // Load payment payload whenever visibility parameters or target indexes shift
  useEffect(() => {
    if (customerId) {
      fetchAccessRequests();
    }
  }, [customerId]);

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payment/check-access/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchPaymentDetails();
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

  const fetchPaymentDetails = async () => {
    setLoading(true);
    try {
      const dataRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payment/${customerId}/`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });

      if (dataRes.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }

      if (dataRes.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (dataRes.ok) {
        const resData = await dataRes.json();
        setProjectCost(resData.project_cost || 0);
        setLoanAmount(resData.loan_amount || 0);
        if (resData.payment) {
          setPaymentData(resData.payment);
          populateForm(resData.payment);
        } else {
          resetForm();
        }
      }
    } catch (err) {
      console.error("Error loading payment data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccessSubmit = async (permissionType) => {
    setRequestLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payment/request-access/`, {
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

  const populateForm = (pay) => {
    setAdvanceAmount(pay.advance_amount || "");
    setAdvanceDate(pay.advance_amount_date ? pay.advance_amount_date.substring(0, 10) : "");
    setSecondPayment(pay.second_payment || "");
    setSecondPaymentDate(pay.second_payment_date ? pay.second_payment_date.substring(0, 10) : "");
    setComments(pay.comments || "");
    
    const baseMethods = ["Cash in Hand", "Online", "Cheque"];
    if (pay.payment_method && !baseMethods.includes(pay.payment_method)) {
      setPaymentMethod("Other");
      setCustomMethod(pay.payment_method);
    } else {
      setPaymentMethod(pay.payment_method || "");
      setCustomMethod("");
    }

    if (pay.additional_payments) {
      try {
        const parsed = typeof pay.additional_payments === 'string' ? JSON.parse(pay.additional_payments) : pay.additional_payments;
        setAdditionalPayments(parsed || []);
      } catch (e) {
        setAdditionalPayments([]);
      }
    } else {
      setAdditionalPayments([]);
    }

    if (pay.proof_file) {
      try {
        const parsedProofs = JSON.parse(pay.proof_file);
        setExistingProofs(Array.isArray(parsedProofs) ? parsedProofs : [pay.proof_file]);
      } catch (e) {
        setExistingProofs([pay.proof_file]);
      }
    } else {
      setExistingProofs([]);
    }
    setProofFiles([]);
    setProofPreviews([]);
    setRemovedProofs([]);
  };

  const resetForm = () => {
    setAdvanceAmount("");
    setAdvanceDate("");
    setSecondPayment("");
    setSecondPaymentDate("");
    setPaymentMethod("");
    setCustomMethod("");
    setComments("");
    setAdditionalPayments([]);
    setProofFiles([]);
    setProofPreviews([]);
    setExistingProofs([]);
    setRemovedProofs([]);
  };

  const calculateTotalReceived = () => {
    const adv = parseFloat(advanceAmount) || 0;
    const sec = parseFloat(secondPayment) || 0;
    const addTotal = additionalPayments.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    return loanAmount + adv + sec + addTotal;
  };

  const calculateRemainingDue = () => {
    return projectCost - calculateTotalReceived();
  };

  const ordinalSuffix = (n) => {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return "th";
    switch (n % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  };

  const handleAddAdditionalPayment = () => {
    if (!canUpdate) return;
    const nextIdx = additionalPayments.length + 3;
    setAdditionalPayments([...additionalPayments, { label: `${nextIdx}${ordinalSuffix(nextIdx)} Payment`, amount: "", date: "" }]);
  };

  const handleUpdateAdditionalField = (index, field, value) => {
    if (!canUpdate) return;
    const updated = [...additionalPayments];
    updated[index][field] = value;
    setAdditionalPayments(updated);
  };

  const handleRemoveAdditionalField = (index) => {
    if (!canUpdate) return;
    const filtered = additionalPayments.filter((_, i) => i !== index);
    const updatedLabels = filtered.map((p, i) => ({
      ...p,
      label: `${i + 3}${ordinalSuffix(i + 3)} Payment`
    }));
    setAdditionalPayments(updatedLabels);
  };

  const handleFileChange = (e) => {
    if (!canUpdate) return;
    const chosenFiles = Array.from(e.target.files);
    if (chosenFiles.length > 0) {
      setProofFiles((prev) => [...prev, ...chosenFiles]);
      const dynamicPreviews = chosenFiles.map((file) => ({
        name: file.name,
        type: file.type,
        url: URL.createObjectURL(file)
      }));
      setProofPreviews((prev) => [...prev, ...dynamicPreviews]);
    }
  };

  const handleRemoveNewFilePreview = (idxToRemove) => {
    if (!canUpdate) return;
    if (proofPreviews[idxToRemove]?.url) {
      URL.revokeObjectURL(proofPreviews[idxToRemove].url);
    }
    setProofFiles((prev) => prev.filter((_, i) => i !== idxToRemove));
    setProofPreviews((prev) => prev.filter((_, i) => i !== idxToRemove));
  };

  const handleRemoveExistingProof = (urlToRemove) => {
    if (!canUpdate) return;
    setRemovedProofs((prev) => [...prev, urlToRemove]);
    setExistingProofs((prev) => prev.filter((url) => url !== urlToRemove));
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const dateParts = dateString.split("-");
    if (dateParts.length === 3) {
      return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    }
    return dateString;
  };

  const handleSaveClick = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security matrix context lacks required write permissions.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save Payment Records Changes",
      message: "Are you sure you want to save these payment record changes?",
      onConfirm: executeSave
    });
  };

  const executeSave = async () => {
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    setLoading(true);

    const payload = new FormData();
    payload.append("advance_amount", advanceAmount);
    payload.append("advance_amount_date", advanceDate);
    payload.append("second_payment", secondPayment);
    payload.append("second_payment_date", secondPaymentDate);
    payload.append("payment_method", paymentMethod === "Other" ? customMethod : paymentMethod);
    payload.append("comments", comments);
    payload.append("additional_payments", JSON.stringify(additionalPayments));
    payload.append("removed_proofs", JSON.stringify(removedProofs));

    proofFiles.forEach((file) => {
      payload.append("proof_files", file);
    });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payment/${customerId}/`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: payload
      });

      if (response.ok) {
        setIsEditing(false);
        fetchPaymentDetails();
      } else {
        alert("Failed to save payment details. Please check permissions.");
      }
    } catch (err) {
      console.error("Save Error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Render Lock Wrapper Screen if global permissions configuration blocks module lookups
  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted</h3>
          <p>You don't have permission to access the Payment metrics dashboard.</p>
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

  const remainingDue = calculateRemainingDue();

  return (
    <div className="sitevisit-section">
      {loading && (
        <div className="sitevisit-loading-overlay">
          <div className="table-spinner"></div>
          Loading...
        </div>
      )}

      {!isEditing ? (
        <div className="payment-flow-view-container">
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "15px" }}>
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>Payment Details</h2>
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
            <div className="detail-item-node">
              <span className="node-label">Advance Payment:</span>
              <span className="node-value">₹{(parseFloat(advanceAmount) || 0).toLocaleString('en-IN')}</span>
              {advanceDate && (
                <span className="payment-flow-date-badge">
                  ({formatDate(advanceDate)})
                </span>
              )}
            </div>

            <div className="detail-item-node">
              <span className="node-label">2nd Payment:</span>
              <span className="node-value">₹{(parseFloat(secondPayment) || 0).toLocaleString('en-IN')}</span>
              {secondPaymentDate && (
                <span className="payment-flow-date-badge">
                  ({formatDate(secondPaymentDate)})
                </span>
              )}
            </div>

            {additionalPayments.length > 0 && additionalPayments.map((item, i) => (
              <div key={i} className="detail-item-node">
                <span className="node-label">{item.label}:</span>
                <span className="node-value">₹{(parseFloat(item.amount) || 0).toLocaleString('en-IN')}</span>
                {item.date && (
                  <span className="payment-flow-date-badge">
                    ({formatDate(item.date)})
                  </span>
                )}
              </div>
            ))}

            <div className="detail-item-node">
              <span className="node-label">Loan Amount:</span>
              <span className="node-value">₹{(parseFloat(loanAmount) || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="detail-data-grid">
            <div className="detail-item-node">
              <span className="node-label">Payment Method:</span>
              <span className="node-value">{(paymentMethod === "Other" ? customMethod : paymentMethod) || "Not Specified"}</span>
            </div>
          </div>
          

           <div className="detail-data-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
               
            <div className="detail-item-node">
              <span className="node-label">Total Amount Received:</span>
              <span className="node-value" style={{ color: '#10b981' }}>₹ {calculateTotalReceived().toLocaleString('en-IN')}</span>
            </div>
            <div className="detail-item-node">
              <span className="node-label">Total Project Cost:</span>
              <span className="node-value" style={{ color: '#2563eb' }} >₹ {projectCost.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="outstanding-due-wrapper">
            <div className={`outstanding-due-card ${remainingDue > 0 ? 'due-positive' : 'due-clear'}`}>
              <span className="node-label font-bold outstanding-due-title">
                Outstanding Due: 
              </span>
              <span className="node-value font-bold outstanding-due-value" style={{color: remainingDue > 0 ? '#e00a0a' : '#047857' }}>
                &nbsp;₹ {remainingDue.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="text-narrative-block">
            <label className="narrative-label">Comments & Notes</label>
            <p className="comments-text-display">{comments || "No comments written for this profile record."}</p>
          </div>

          {existingProofs.length > 0 && (
            <div className="document-vault-section">
              <h4 className="vault-group-title">Uploaded Payment Receipts</h4>
              <div className="payment-receipts-gallery-grid">
                {existingProofs.map((url, index) => {
                  const isPdf = url.toLowerCase().includes('.pdf');
                  return (
                    <a key={index} href={url} target="_blank" rel="noreferrer" className="receipt-gallery-item-card">
                      {isPdf ? (
                        <div className="receipt-pdf-fallback-frame">
                          <FaFileAlt className="receipt-pdf-gallery-icon" />
                          <span className="receipt-pdf-text-tag">PDF Receipt</span>
                        </div>
                      ) : (
                        <img src={url} alt={`Uploaded Receipt ${index + 1}`} className="receipt-gallery-medium-image" />
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div className="payment-action-center-wrapper">
            {canUpdate && (
              <button type="button" className="btn-action-edit payment-btn-wide" onClick={() => setIsEditing(true)}>
                <FaEdit /> Edit Details
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveClick} className="interactive-form-workspace payment-flow-form-container">
          <h3 className="workspace-pane-title">{paymentData?.id ? "Edit Payment Details" : "Add New Payments"}</h3>
          
          <div className="payment-flow-form-fields-grid">
            
            <div className="payment-form-row-divider">
              <div className="form-group-element payment-full-width-field">
                <label>Advance Payment Amount (₹)</label>
                <input type="number" min="0" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} disabled={!canUpdate} placeholder="0" onWheel={(e) => e.target.blur()} />
              </div>
              <div className="form-group-element payment-full-width-field">
                <label>Advance Date</label>
                <input type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} disabled={!canUpdate} />
              </div>
            </div>

            <div className="payment-form-row-divider">
              <div className="form-group-element payment-full-width-field">
                <label>2nd Payment Amount (₹)</label>
                <input type="number" min="0" value={secondPayment} onChange={(e) => setSecondPayment(e.target.value)} disabled={!canUpdate} placeholder="0" onWheel={(e) => e.target.blur()} />
              </div>
              <div className="form-group-element payment-full-width-field">
                <label>2nd Payment Date</label>
                <input type="date" value={secondPaymentDate} onChange={(e) => setSecondPaymentDate(e.target.value)} disabled={!canUpdate} />
              </div>
            </div>

            <div className="document-vault-section payment-dynamic-rows-bg">
              <div className="mnre-header-flex-row payment-flex-between">
                <h4 className="vault-group-title row-margin-reset">Additional Installment Steps</h4>
                <button type="button" onClick={handleAddAdditionalPayment} disabled={!canUpdate} className="btn-action-edit payment-btn-small">
                  <FaPlus /> Add Payment Row
                </button>
              </div>

              {additionalPayments.map((item, idx) => (
                <div key={idx} className="payment-additional-card-item">
                  <div className="payment-flex-between payment-full-width-field">
                    <span className="payment-item-label-weight">{item.label}:</span>
                    <button type="button" onClick={() => handleRemoveAdditionalField(idx)} disabled={!canUpdate} className="payment-delete-card-btn">
                      <FaTrash size={12} />
                    </button>
                  </div>
                  <input
                    type="number"
                    placeholder="Amount (₹)"
                    value={item.amount}
                    className="payment-box-input"
                    onChange={(e) => handleUpdateAdditionalField(idx, 'amount', e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    disabled={!canUpdate}
                    required
                  />
                  <input
                    type="date"
                    value={item.date}
                    className="payment-box-input"
                    onChange={(e) => handleUpdateAdditionalField(idx, 'date', e.target.value)}
                    onWheel={(e) => e.target.blur()}
                    disabled={!canUpdate}
                  />
                </div>
              ))}
            </div>

            <div className="payment-live-ledger-banner">
              <span className="payment-live-ledger-title">Total Amount Received:</span>
              <div className="payment-live-ledger-value">
                ₹{calculateTotalReceived().toLocaleString('en-IN')}
              </div>
            </div>

            <div className="form-group-element">
              <label>Payment Method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={!canUpdate} className="control-select-dropdown">
                <option value="">Select Option...</option>
                <option value="Cash in Hand">Cash in Hand</option>
                <option value="Online">Online</option>
                <option value="Cheque">Cheque</option>
                <option value="Other">Other (Type custom option)...</option>
              </select>
            </div>

            {paymentMethod === "Other" && (
              <div className="form-group-element">
                <label>Type Custom Payment Method</label>
                <input type="text" value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} disabled={!canUpdate} placeholder="e.g. Bank Transfer" required />
              </div>
            )}

            <div className="form-group-element textarea-full-span">
              <label>Comments & Internal Notes</label>
              <textarea rows="3" value={comments} onChange={(e) => setComments(e.target.value)} disabled={!canUpdate}/>
            </div>

            <div className="vault-uploader-block">
              <label>Upload Payment Receipts</label>
              <div className="payment-uploader-flex-row vertical-stack-previews">
                
                <input type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} disabled={!canUpdate} />

                {(existingProofs.length > 0 || proofPreviews.length > 0) && (
                  <div style={{ width: "100%", marginTop: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "500", display: "block", marginBottom: "6px" }}>
                      Uploaded Documents & Previews:
                    </span>
                    
                    <div className="payment-receipts-gallery-grid">
                      {existingProofs.map((url, i) => {
                        const isPdf = url.toLowerCase().includes('.pdf');
                        return (
                          <div key={`existing-${i}`} className="receipt-tile-container">
                            {isPdf ? (
                              <div className="receipt-pdf-fallback-frame">
                                <FaFileAlt className="receipt-pdf-gallery-icon" />
                                <span className="receipt-pdf-text-tag">PDF</span>
                              </div>
                            ) : (
                              <img src={url} alt={`Receipt ${i + 1}`} className="receipt-gallery-medium-image" />
                            )}
                            <button type="button" onClick={() => handleRemoveExistingProof(url)} disabled={!canUpdate} className="tile-floating-remove-btn">
                              <FaTimes />
                            </button>
                          </div>
                        );
                      })}

                      {proofPreviews.map((preview, index) => {
                        const isPdf = preview.name.toLowerCase().endsWith('.pdf') || (preview.type && preview.type === 'application/pdf');
                        return (
                          <div key={`staged-${index}`} className="receipt-tile-container">
                            {isPdf ? (
                              <div className="receipt-pdf-fallback-frame">
                                <FaFileAlt className="receipt-pdf-gallery-icon" />
                                <span className="receipt-pdf-text-tag">PDF</span>
                              </div>
                            ) : (
                              <img src={preview.url} alt="Staged item" className="receipt-gallery-medium-image" />
                            )}
                            <button type="button" onClick={() => handleRemoveNewFilePreview(index)} disabled={!canUpdate} className="tile-floating-remove-btn">
                              <FaTimes />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>

          <div className="workspace-action-trigger-row center-aligned-row payment-form-action-margin">
            {canUpdate && <button type="submit" className="btn-action-edit payment-btn-md">Save Changes</button>}
            <button type="button" className="btn-action-cancel payment-btn-md" onClick={() => { setIsEditing(false); if(paymentData) populateForm(paymentData); }}>
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
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default PaymentFlow;