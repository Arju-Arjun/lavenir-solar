import React from "react";

function ConfirmationModal({
  isOpen,
  title = "Confirm action",
  message = "Are you sure you want to continue?",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isLoading = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="confirm-overlay">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h4 id="confirm-dialog-title">{title}</h4>

        <p className="confirm-message">{message}</p>

        <div className="confirm-actions">
          <button
            type="button"
            className="cancel-btn"
            onClick={onCancel} // This hook now fires correctly when clicked
            disabled={isLoading}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            className={`save-btn-confirm ${isLoading ? "loading-active" : ""}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="btn-loading-flex">
                <span className="spinner-icon"></span>
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;