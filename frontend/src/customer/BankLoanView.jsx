import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FaLock, FaEdit, FaFilePdf, FaPlus, FaTrash, FaPaperPlane } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal";
import { useAuth } from "../context/AuthContext";

const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL}/api/bank-loan`;

const getPdfPreviewUrl = (path) => {
  if (!path) return "#";
  if (path.toLowerCase().endsWith(".pdf") || path.includes("/raw/upload/")) {
    // return `https://docs.google.com/gview?url=${encodeURIComponent(path)}&embedded=true`;
    return `https://docs.google.com/viewerng/viewer?url=${encodeURIComponent(path)}`;
  }
  return path;
};

// Shared ordinal helper (was duplicated in add/remove handlers)
const ordinalSuffix = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
};

const relabelPayments = (list) =>
  list.map((p, i) => ({ ...p, label: `${i + 1}${ordinalSuffix(i + 1)} Payment` }));

const emptyPayments = () => [{ label: "1st Payment", amount: "" }];

const BankLoanView = ({ customerId }) => {
  const { permissions, refetchPermissions, isAdmin, role } = useAuth();
  const modulePermissions = permissions["Bank Loan"] || permissions["BankLoan"] || { view: false, create: false, update: false };
  const canView = isAdmin || role === "admin" || modulePermissions.view;
  const canUpdate = isAdmin || role === "admin" || modulePermissions.update;

  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const [mnreCompleted, setMnreCompleted] = useState(false);
  const [loanData, setLoanData] = useState(null);
  const [pendingRequests, setPendingRequests] = useState({});
  const [requestLoading, setRequestLoading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const [acknowledgementFile, setAcknowledgementFile] = useState(null);
  const fileInputRef = useRef(null);

  // Form state
  const [needLoan, setNeedLoan] = useState(true);
  const [jansamarthStatus, setJansamarthStatus] = useState("Pending");
  const [documentSubmission, setDocumentSubmission] = useState("");
  const [comment, setComment] = useState("");
  const [payments, setPayments] = useState(emptyPayments());
  const [totalApprovedLoanAmount, setTotalApprovedLoanAmount] = useState("");

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // ---- Centralized auth/fetch helper ----
  // Avoids repeating `Authorization` header + token lookup in every call site,
  // and centralizes 401 handling.
  const authFetch = useCallback(async (path, options = {}) => {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) {
      handleLogout();
      throw new Error("Unauthorized");
    }
    return res;
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user_role");
    localStorage.removeItem("user_profile");
    window.location.reload();
  };

  const populateFormFields = (loan) => {
    setNeedLoan(loan.need_loan);
    setJansamarthStatus(loan.jansamarth_status || "Pending");
    setDocumentSubmission(loan.document_submission || "");
    setComment(loan.comment || "");
    setTotalApprovedLoanAmount(loan.total_approved_loan_amount || "");
    setPayments(loan.loan_payments && loan.loan_payments.length > 0 ? loan.loan_payments : emptyPayments());
  };

  const fetchLoanDataset = useCallback(async (signal) => {
    setLoading(true);
    try {
      const datasetRes = await authFetch(`/${customerId}/`, { signal });

      if (datasetRes.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (datasetRes.ok) {
        const resData = await datasetRes.json();
        if (resData.mnre_status && resData.mnre_status.trim() === "Completed") {
          setMnreCompleted(true);
          if (resData.loan) {
            setLoanData(resData.loan);
            populateFormFields(resData.loan);
          } else {
            setLoanData(null);
          }
        } else {
          setMnreCompleted(false);
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Initialization fault on pipeline verification", err);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch, customerId]);

  const fetchAccessRequests = useCallback(async (signal) => {
    try {
      const res = await authFetch("/check-access/", { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.pending_requests) {
          setPendingRequests(data.pending_requests);
        }
        if (data.view || canView) {
          setAccessDenied(false);
          fetchLoanDataset(signal);
        } else {
          setAccessDenied(true);
        }
      } else if (res.status === 403) {
        setAccessDenied(true);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to check access privileges:", err);
        if (!canView) setAccessDenied(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, canView, fetchLoanDataset]);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    fetchAccessRequests(controller.signal);
    // Abort in-flight requests if customerId changes or component unmounts,
    // preventing state updates on stale/unmounted requests.
    return () => controller.abort();
  }, [customerId, fetchAccessRequests]);

  const handleRequestAccess = async (type) => {
    setRequestLoading(true);
    try {
      const res = await authFetch("/request-access/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission_type: type }),
      });
      if (res.ok) {
        const result = await res.json();
        setPendingRequests((prev) => ({ ...prev, [type]: "Pending" }));
        alert(result.message);
        if (refetchPermissions) refetchPermissions();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRequestLoading(false);
    }
  };

  const handleRadioClick = (value) => {
    if (!needLoan || !canUpdate) return;
    setDocumentSubmission((prev) => (prev === value ? "" : value));
  };

  const handlePaymentChange = (index, val) => {
    if (!canUpdate) return;
    if (val !== "" && parseFloat(val) < 0) return;
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, amount: val } : p)));
  };

  const addNewPaymentField = () => {
    if (!canUpdate || !needLoan) return;
    setPayments((prev) => {
      const nextOrdinal = prev.length + 1;
      return [...prev, { label: `${nextOrdinal}${ordinalSuffix(nextOrdinal)} Payment`, amount: "" }];
    });
  };

  const removePaymentField = (index) => {
    if (!canUpdate || index === 0) return;
    setPayments((prev) => relabelPayments(prev.filter((_, i) => i !== index)));
  };

  // Memoized so these only recompute when payments/amount actually change,
  // rather than on every render.
  const totalReceived = useMemo(
    () => payments.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0),
    [payments]
  );
  const dueAmount = useMemo(
    () => (parseFloat(totalApprovedLoanAmount) || 0) - totalReceived,
    [totalApprovedLoanAmount, totalReceived]
  );

  const triggerSaveConfirm = (e) => {
    e.preventDefault();
    if (!canUpdate) {
      alert("Operational Guardrail: Security matrix context lacks required write clearance parameters.");
      return;
    }
    setModalConfig({
      isOpen: true,
      title: "Save Bank Loan Changes",
      message: "Are you sure you want to save these Bank Loan changes?",
      onConfirm: executeSubmission,
    });
  };

  const executeSubmission = async () => {
    setModalConfig((prev) => ({ ...prev, isOpen: false }));
    setLoading(true);

    const payload = new FormData();
    payload.append("need_loan", needLoan);
    payload.append("jansamarth_status", jansamarthStatus);
    payload.append("document_submission", documentSubmission);
    payload.append("comment", comment);
    payload.append("total_approved_loan_amount", totalApprovedLoanAmount !== "" ? totalApprovedLoanAmount : 0);

    const cleanPayments = payments.map((p) => ({
      label: p.label,
      amount: p.amount !== "" ? parseFloat(p.amount) : 0.0,
    }));
    payload.append("loan_payments", JSON.stringify(cleanPayments));

    if (acknowledgementFile) {
      payload.append("acknowledgement_file", acknowledgementFile);
    }

    try {
      const response = await authFetch(`/${customerId}/`, {
        method: "POST",
        body: payload,
      });
      if (response.ok) {
        setIsEditing(false);
        setAcknowledgementFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchLoanDataset();
      } else {
        const errorData = await response.json();
        alert(`Transaction validation failure: ${errorData.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setAcknowledgementFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (loanData) {
      populateFormFields(loanData);
    } else {
      setNeedLoan(true);
      setJansamarthStatus("Pending");
      setDocumentSubmission("");
      setComment("");
      setTotalApprovedLoanAmount("");
      setPayments(emptyPayments());
    }
  };

  if (!canView || accessDenied) {
    return (
      <div className="permission-locked-wrapper-card">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon" />
          <h3>Access Restricted </h3>
          <p>You don't have permission to access the Bank Loan workspace.</p>
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

  if (loading && !loanData && !mnreCompleted) {
    return (
      <div className="sitevisit-loading-overlay" style={{ position: "relative", minHeight: "200px", background: "transparent" }}>
        <div className="table-spinner"></div>
        <p style={{ textAlign: "center", marginTop: "10px", color: "#64748b" }}>Loading...</p>
      </div>
    );
  }

  if (!mnreCompleted) {
    return (
      <div className="permission-locked-wrapper-card mnre-locked-card-override">
        <div className="permission-locked-content-box">
          <FaLock className="lock-vector-icon mnre-locked-icon-override" />
          <h3 className="mnre-locked-heading-override">Bank Loan Module Locked</h3>
          <p className="mnre-locked-text-override">
            This workspace remains offline until structural workflow parameters inside the
            <strong> MNRE Profile Workspace</strong> match an authorized <strong>MNRE Status: Completed</strong> milestone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sitevisit-section">
      {loading && (
        <div className="sitevisit-loading-overlay">
          <div className="table-spinner"></div>Loading...
        </div>
      )}

      {!isEditing ? (
        <div className="site-details-deck">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: "12px",
              marginBottom: "15px",
            }}
          >
            <h2 className="workspace-pane-title" style={{ margin: 0 }}>
              BANK LOAN 
            </h2>
            <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
              {!canUpdate &&
                (pendingRequests["update"] === "Pending" ? (
                  <span style={{ fontSize: "0.8rem", color: "#ca8a04", fontWeight: "600" }}>⚠️ Update Request Pending</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRequestAccess("update")}
                    disabled={requestLoading}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "0.75rem",
                      padding: "4px 8px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      cursor: "pointer",
                      color: "#475569",
                    }}
                  >
                    <FaPaperPlane size={10} /> Request Update Authorization
                  </button>
                ))}
            </div>
          </div>

          {!loanData || !loanData.need_loan ? (
            <div className="centered-placeholder-box">
              <p className="placeholder-primary-msg">No Bank Loan parameter profile records have been generated yet.</p>
              {canUpdate ? (
                <button type="button" className="btn-action-edit mnre-placeholder-btn-wrapper" onClick={() => setIsEditing(true)}>
                  <FaEdit /> Need Loan
                </button>
              ) : pendingRequests["update"] === "Pending" ? (
                <div className="sitevisit-alert-success-banner">⚠️ Update Request Pending Approval</div>
              ) : (
                <button type="button" className="request-access-trigger-btn" onClick={() => handleRequestAccess("update")}>
                  Request Operational Initialization Clearance
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="detail-data-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                <div className="detail-item-node">
                  <span className="node-label">Loan Requirement State:</span>
                  <span className={`status-badge-token-mnre ${loanData.need_loan ? "mnre-status-badge-completed" : "mnre-status-badge-pending"}`}>
                    {loanData.need_loan ? "Required" : "Not Needed"}
                  </span>
                </div>
                {loanData.need_loan && (
                  <>
                    <div className="detail-item-node">
                      <span className="node-label">Jansamarth Status:</span>
                      <span className={`status-badge-token-mnre ${loanData.jansamarth_status === "Completed" ? "mnre-status-badge-completed" : "mnre-status-badge-pending"}`}>
                        {loanData.jansamarth_status}
                      </span>
                    </div>
                    <div className="detail-item-node">
                      <span className="node-label">Document Submission Route:</span>
                      {loanData.document_submission ? (
                        <span className="node-value">{loanData.document_submission}</span>
                      ) : (
                        <span style={{fontSize: "0.65rem", color: "#64748b" }}>N/A</span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {loanData.need_loan && (
                <>
                  <div className="document-vault-section mnre-margin-top-md">
                    <h4 className="vault-group-title">Payments</h4>
                    <div className="detail-data-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
                      {loanData.loan_payments?.map((pay, idx) => (
                        <div key={idx} className="detail-item-node">
                          <span className="node-label">{pay.label}:</span>
                          <span className="node-value">₹{parseFloat(pay.amount || 0).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="document-vault-section mnre-margin-top-md">
                    <h4 className="vault-group-title">Loan Amount  </h4>
                    <div className="detail-data-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
                      <div className="detail-item-node">
                        <span className="node-label">Total Approved Loan Amount:</span>
                        <span className="node-value" style={{ color: "blue" }}>
                          ₹{parseFloat(loanData.total_approved_loan_amount || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div className="detail-item-node">
                        <span className="node-label">Total Received Loan Amount:</span>
                        <span className="node-value" style={{ color: "green" }}>
                          ₹{parseFloat(loanData.total_loan_amount || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                    <div className="outstanding-due-wrapper" style={{ marginTop: "15px" }}>
                      <div
                        className="outstanding-due-card"
                        style={{ background: "#f0fdf4", border: "1px solid #d1fae5", padding: "12px 16px", borderRadius: "8px", display: "inline-block" }}
                      >
                        <span className="node-label font-bold outstanding-due-title">Due Amount: </span>
                        <span
                          className="node-value font-bold outstanding-due-value"
                          style={{ color: (parseFloat(loanData.due_amount) || 0) > 0 ? "#e00a0a" : "#047857" }}
                        >
                          &nbsp;₹{(parseFloat(loanData.due_amount) || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-narrative-block mnre-margin-top-md">
                    <label className="narrative-label">Comments</label>
                    <p className="comments-text-display">{loanData.comment || ""}</p>
                  </div>

                  {loanData.acknowledgement_file && (
                    <div className="document-vault-section mnre-margin-top-md">
                      <h4 className="vault-group-title">Acknowledgement Document</h4>
                      <div className="doc-preview-badge-row">
                        <a href={getPdfPreviewUrl(loanData.acknowledgement_file)} target="_blank" rel="noopener noreferrer" className="vault-doc-badge">
                          <FaFilePdf /> Loan Acknowledgement File
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="payment-action-center-wrapper" style={{ marginTop: "20px" }}>
                    {canUpdate && (
                      <button type="button" className="btn-action-edit payment-btn-wide" onClick={() => setIsEditing(true)}>
                        <FaEdit /> Edit Details
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <form onSubmit={triggerSaveConfirm} className="interactive-form-workspace">
          <div className="mnre-header-flex-row">
            <h2 className="workspace-pane-title">Bank Loan Details</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="node-label">Loan Required:</span>
              <button
                type="button"
                className={`btn-action-edit ${!needLoan ? "mnre-locked-card-override" : ""}`}
                style={{ backgroundColor: needLoan ? "#10b981" : "#6b7280", color: "#fff", padding: "6px 16px" }}
                onClick={() => {
                  if (canUpdate) setNeedLoan(!needLoan);
                }}
                disabled={!canUpdate}
              >
                {needLoan ? "YES" : "NO"}
              </button>
            </div>
          </div>

          <div className={`form-container-wrapper-conditional ${!needLoan ? "disabled-gray-context-lock" : ""}`} style={{ opacity: needLoan ? 1 : 0.45 }}>
            <div className="form-grid-layout mnre-form-spacing">
              <div className="form-group-element">
                <label>Jansamarth Status</label>
                <select
                  value={jansamarthStatus}
                  onChange={(e) => setJansamarthStatus(e.target.value)}
                  className="control-select-dropdown mnre-select-input-wrapper"
                  disabled={!needLoan || !canUpdate}
                >
                  <option value="Pending">Pending</option>
                  <option value="Partially Done">Partially Done</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div className="form-group-element">
                <label>Document Submission</label>
                <div className="radio-flex-row-alignment" style={{ display: "flex", gap: "15px", marginTop: "8px" }}>
                  {["By Hand", "Mail", "By Hand and Mail"].map((route) => (
                    <label key={route} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: needLoan && canUpdate ? "pointer" : "not-allowed" }}>
                      <input
                        type="radio"
                        name="submission_route"
                        checked={documentSubmission === route}
                        onClick={() => handleRadioClick(route)}
                        onChange={() => {}}
                        disabled={!needLoan || !canUpdate}
                      />
                      <span>{route}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="document-vault-section mnre-margin-top-md" style={{ background: "#f8fafc", padding: "15px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <h4 className="vault-group-title" style={{ marginBottom: "15px" }}>Payment Details</h4>

              <div className="loan-summary-grid">
                <div className="form-group-element">
                  <label>Total Approved Loan Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={totalApprovedLoanAmount}
                    onChange={(e) => setTotalApprovedLoanAmount(e.target.value)}
                    placeholder="0.00"
                    className="vault-raw-file-selector input-amount-highlight"
                    disabled={!needLoan || !canUpdate}
                    onWheel={(e) => e.target.blur()}
                  />
                </div>
                <div className="form-group-element summary-read-only">
                  <label>Total Received (Auto-calculated)</label>
                  <div className="summary-value received-amount">₹{totalReceived.toLocaleString("en-IN")}</div>
                </div>
                <div className="form-group-element summary-read-only">
                  <label>Due Amount (Auto-calculated)</label>
                  <div className={`summary-value ${dueAmount > 0 ? "due-amount-warning" : "due-amount-clear"}`}>
                    ₹{dueAmount.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </div>

            <div className="document-vault-section mnre-margin-top-md" style={{ background: "#f8fafc", padding: "15px", borderRadius: "8px" }}>
              <div className="mnre-header-flex-row" style={{ marginBottom: "12px" }}>
                <h4 className="vault-group-title" style={{ margin: 0 }}>Payment Schedule</h4>
                <button
                  type="button"
                  onClick={addNewPaymentField}
                  disabled={!needLoan || !canUpdate}
                  className="btn-action-edit"
                  style={{ padding: "4px 10px", fontSize: "13px", display: "flex", alignItems: "center", gap: "5px" }}
                >
                  <FaPlus /> Add Term Block
                </button>
              </div>

              <div className="form-grid-layout">
                {payments.map((payment, index) => (
                  <div key={index} className="form-group-element" style={{ position: "relative" }}>
                    <label>{payment.label} (₹)</label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="number"
                        min="0"
                        value={payment.amount}
                        onChange={(e) => handlePaymentChange(index, e.target.value)}
                        placeholder="0.00"
                        className="vault-raw-file-selector"
                        style={{ padding: "8px" }}
                        disabled={!needLoan || !canUpdate}
                        onWheel={(e) => e.target.blur()}
                      />
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => removePaymentField(index)}
                          className="btn-action-cancel"
                          style={{ padding: "8px 12px", background: "#ef4444", color: "#fff" }}
                          disabled={!canUpdate}
                        >
                          <FaTrash />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group-element textarea-full-span mnre-margin-top-md">
              <label>Comments</label>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows="3" disabled={!needLoan || !canUpdate} />
            </div>

            <div className="vault-uploader-block mnre-margin-top-md">
              <h4 className="vault-group-title">Payment Receipts</h4>
              <div className="form-group-element">
                <label>
                  {loanData?.acknowledgement_file && <span className="vault-upload-status-tick">✓ </span>}
                  Select Acknowledgment File Target
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf"
                  onChange={(e) => {
                    if (canUpdate) setAcknowledgementFile(e.target.files[0]);
                  }}
                  className="vault-raw-file-selector"
                  disabled={!needLoan || !canUpdate}
                />
              </div>
            </div>
          </div>

          <div className="workspace-action-trigger-row center-aligned-row mnre-margin-top-lg">
            {canUpdate && (
              <button type="submit" className="btn-action-edit">
                Save Changes
              </button>
            )}
            <button type="button" className="btn-action-cancel" onClick={handleCancel}>
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

export default BankLoanView;