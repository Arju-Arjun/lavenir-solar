import React from 'react';

const NOTIF_ICONS = {
  payment: '💰',
  staff: '👷',
  kseb: '⚡',
  customer: '👤',
  mnre: '📋',
  service: '🔧',
  general: '🔔'
};

// popup: a single notification object from GET /notifications/popups/pending
// onClose: called with the popup's id when X or OK is clicked
function NotificationPopup({ popup, onClose }) {
  if (!popup) return null;

  return (
    <div className="notification-popup-overlay">
      <div className="notification-popup-card" role="dialog" aria-modal="true">
        <button
          className="notification-popup-close-icon"
          onClick={() => onClose(popup.id)}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="notification-popup-icon">
          {NOTIF_ICONS[popup.notif_type] || NOTIF_ICONS.general}
        </div>

        <h3 className="notification-popup-title">{popup.title}</h3>
        <p className="notification-popup-message">{popup.message}</p>

        <button
          className="notification-popup-ok-btn"
          onClick={() => onClose(popup.id)}
        >
          OK
        </button>
      </div>
    </div>
  );
}

export default NotificationPopup;