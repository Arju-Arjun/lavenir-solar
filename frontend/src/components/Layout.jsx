import React, { useState, useEffect, useRef } from 'react';
import { FaHome } from 'react-icons/fa';
import { subscribeToPush } from '../utils/push';
import { timeAgo } from '../utils/timeAgo';
import { notificationsApi } from '../utils/dashboardApi';
import NotificationPopup from './NotificationPopup';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

const NOTIF_ICONS = {
  payment: '💰',
  staff: '👷',
  kseb: '⚡',
  customer: '👤',
  mnre: '📋',
  service: '🔧',
  general: '🔔'
};

function Layout({ user, role, onLogout, currentPath, navigateTo, children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);

  // ---- Center-screen popup queue (separate from bell dropdown) ----
  const [popupQueue, setPopupQueue] = useState([]);   // full pending list from server
  const [activePopup, setActivePopup] = useState(null); // the one currently on screen
  const nextPopupTimerRef = useRef(null);

  const POPUP_ADVANCE_DELAY_MS = 700; // gap between one closing and the next appearing

  // ---- Popup queue: fetch pending, merge in anything new, never touch the
  // one currently on screen (only appended to, never replaced mid-display so
  // an active popup never gets yanked out from under the user)
  const fetchPendingPopups = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const data = await notificationsApi.getPendingPopups();
      setPopupQueue(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const fresh = (data.popups || []).filter(p => !existingIds.has(p.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    } catch (err) {
      console.error('Failed to fetch pending popups:', err);
    }
  };

  // Show the first pending popup as soon as one shows up and nothing is
  // already on screen and no advance-delay is currently ticking (covers
  // login / fresh page visit - first popup appears right away, no gap).
  useEffect(() => {
    if (!activePopup && popupQueue.length > 0 && !nextPopupTimerRef.current) {
      setActivePopup(popupQueue[0]);
    }
  }, [popupQueue, activePopup]);

  const handlePopupClose = (notifId) => {
    notificationsApi.markPopupSeen(notifId).catch(err =>
      console.error('Failed to mark popup seen:', err)
    );

    // Close immediately - background blur lifts and work resumes right away.
    setActivePopup(null);

    setPopupQueue(prev => {
      const updated = prev.filter(p => p.id !== notifId);
      if (updated.length > 0) {
        nextPopupTimerRef.current = setTimeout(() => {
          setActivePopup(updated[0]);
          nextPopupTimerRef.current = null;
        }, POPUP_ADVANCE_DELAY_MS);
      }
      return updated;
    });
  };

  // Clear any pending advance-timer on unmount
  useEffect(() => {
    return () => {
      if (nextPopupTimerRef.current) clearTimeout(nextPopupTimerRef.current);
    };
  }, []);

  // Fetch on mount (covers login / fresh page visit) + poll every 30s so a
  // new notification that fires while the user is mid-work also queues up.
  useEffect(() => {
    fetchPendingPopups();
    const interval = setInterval(fetchPendingPopups, 30000);
    return () => clearInterval(interval);
  }, []);

  const sidebarRef = useRef(null);
  const hamburgerRef = useRef(null);
  const dropdownRef = useRef(null);

  // ---- Fetch notifications (page 1 by default, or append for "load more") ----
  const fetchNotifications = async (pageNum = 1, append = false) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      if (append) setLoadingMore(true);
      const res = await fetch(`${API_BASE}/notifications?page=${pageNum}&per_page=5`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(prev => (append ? [...prev, ...data.notifications] : data.notifications));
        setUnreadCount(data.unread_count);
        setHasMore(data.has_more);
        setPage(pageNum);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      if (append) setLoadingMore(false);
    }
  };

  // ---- Fetch count of pending staff permission requests (admin-only sidebar badge) ----
  const fetchPendingPermissionCount = async () => {
    const token = localStorage.getItem('token');
    if (!token || role !== 'admin') return;
    try {
      const res = await fetch(`${API_BASE}/staff/permissions/requests/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingPermissionCount((data.pending || []).length);
      }
    } catch (err) {
      console.error('Failed to fetch pending permission request count:', err);
    }
  };

  const handleLoadMore = (e) => {
    e.stopPropagation();
    fetchNotifications(page + 1, true);
  };

  const handleMarkAllRead = async (e) => {
    e.stopPropagation();
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const handleNotificationClick = async (item) => {
    const token = localStorage.getItem('token');
    if (!item.is_read) {
      try {
        await fetch(`${API_BASE}/notifications/${item.id}/read`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` }
        });
        setNotifications(prev => prev.map(n => (n.id === item.id ? { ...n, is_read: true } : n)));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }
    setIsNotificationOpen(false);
    if (item.url) navigateTo(item.url);
  };

  // Fetch on mount + poll every 30s (resets to page 1)
  useEffect(() => {
    fetchNotifications(1, false);
    const interval = setInterval(() => fetchNotifications(1, false), 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch pending permission request count on mount + poll every 30s (admin only)
  useEffect(() => {
    fetchPendingPermissionCount();
    const interval = setInterval(fetchPendingPermissionCount, 30000);
    return () => clearInterval(interval);
  }, [role]);

  // Subscribe to push notifications once
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      subscribeToPush(token).catch(err => console.error('Push subscribe failed:', err));
    }
  }, []);

  // Close sidebar / dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        isSidebarOpen &&
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target) &&
        hamburgerRef.current &&
        !hamburgerRef.current.contains(event.target)
      ) {
        setIsSidebarOpen(false);
      }
      if (
        isNotificationOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsNotificationOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSidebarOpen, isNotificationOpen]);

  return (
    <div className="global-frame-container">
      {/* PERSISTENT TOP BAR */}
      <header className="persistent-top-bar">
        <div className="top-bar-left">
          <button
            ref={hamburgerRef}
            className="hamburger-icon-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label="Toggle Navigation Menu"
          >
            ☰
          </button>
        

        <span className="company-branding-title" onClick={() => navigateTo('/')}>
        <img 
          src="/assets/logo1.png" 
          alt="Lavenir Solar Logo" 
          className="brand-logo-img" 
        />
        <span className="brand-text">
          Lavenir <span className="brand-solar">Solar</span>
        </span>
      </span>
        </div>

        <div className="top-bar-right">
          <button className="top-bar-home-link" onClick={() => navigateTo('/')}>
            <FaHome size={30} />
          </button>

          <div className="notification-bell-wrapper" ref={dropdownRef}>
            <button
              className={`notification-bell-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
              onClick={() => {
                setIsNotificationOpen(!isNotificationOpen);
                if (!isNotificationOpen) fetchNotifications(1, false);
              }}
            >
              🔔 {unreadCount > 0 && <span className="notification-badge-count">{unreadCount}</span>}
            </button>

            {isNotificationOpen && (
              <div className="notification-dropdown-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>Recent Notifications</h4>
                  {unreadCount > 0 && (
                    <button className="mark-all-read-btn" onClick={handleMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                <hr />

                {notifications.length === 0 && (
                  <div className="notification-empty-state">No notifications yet 🔔</div>
                )}

                {notifications.map(item => (
                  <div
                    key={item.id}
                    className={`notification-dropdown-item ${!item.is_read ? 'unread' : ''}`}
                    onClick={() => handleNotificationClick(item)}
                    style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}
                  >
                    <span style={{ fontSize: '20px' }}>
                      {NOTIF_ICONS[item.notif_type] || NOTIF_ICONS.general}
                    </span>
                    <div style={{ flex: 1 }}>
                      <strong>{item.title}</strong>
                      <p>{item.message}</p>
                      <span style={{ fontSize: '11px', color: '#999' }}>{timeAgo(item.created_at)}</span>
                    </div>
                  </div>
                ))}

                {hasMore && (
                  <button className="load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* SLIDING SIDEBAR NAVIGATION BASED ON CLEARANCE */}
      <aside ref={sidebarRef} className={`sliding-sidebar-menu ${isSidebarOpen ? 'expanded' : 'collapsed'}`}>
        <div className="sidebar-user-profile-summary">
          <div className="profile-fallback-avatar">{user?.profile_photo ? <img src={user.profile_photo} alt="User Avatar" /> : '👤'}</div>
          <div className="sidebar-profile-info">
            <p className="profile-display-name">{user?.full_name || 'User Profile'}</p>
            <p className="profile-display-role-badge">{role?.toUpperCase()}</p>
          </div>
        </div>
        <nav className="sidebar-navigation-tree">
          {role === 'admin' ? (
            <>
              <button className={`nav-node-item ${currentPath === '/' ? 'active' : ''}`} onClick={() => navigateTo('/')}>Dashboard</button>
              <button className={`nav-node-item ${currentPath === '/customers' ? 'active' : ''}`} onClick={() => navigateTo('/customers')}>View Customers</button>
              <button className={`nav-node-item ${currentPath === '/documents' ? 'active' : ''}`} onClick={() => navigateTo('/documents')}>Documents</button>
              <button className={`nav-node-item ${currentPath === '/workflow-details' ? 'active' : ''}`} onClick={() => navigateTo('/workflow-details')}>Workflow Details</button>
              <button className={`nav-node-item ${currentPath === '/supplements' ? 'active' : ''}`} onClick={() => navigateTo('/supplements')}>Supplement Documents</button>
              <button className={`nav-node-item ${currentPath === '/complaints' ? 'active' : ''}`} onClick={() => navigateTo('/complaints')}>Complaints</button>
              <button className={`nav-node-item ${currentPath === '/reports' ? 'active' : ''}`} onClick={() => navigateTo('/reports')}>Reports</button>
              <button className={`nav-node-item ${currentPath === '/settings' ? 'active' : ''}`} onClick={() => navigateTo('/settings')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Settings</span>
                {pendingPermissionCount > 0 && (
                  <span className="pending-count-badge">
                    {pendingPermissionCount}
                  </span>
                )}
              </button>
              <button className={`nav-node-item ${currentPath === '/profile' ? 'active' : ''}`} onClick={() => navigateTo('/profile')}>Profile</button>
            </>
          ) : (
            <>
              <button className={`nav-node-item ${currentPath === '/' ? 'active' : ''}`} onClick={() => navigateTo('/')}>Dashboard</button>
              <button className={`nav-node-item ${currentPath === '/customers' ? 'active' : ''}`} onClick={() => navigateTo('/customers')}>View Customers</button>
              <button className={`nav-node-item ${currentPath === '/documents' ? 'active' : ''}`} onClick={() => navigateTo('/documents')}>Documents</button>
              <button className={`nav-node-item ${currentPath === '/supplements' ? 'active' : ''}`} onClick={() => navigateTo('/supplements')}>Supplement Documents</button>
              <button className={`nav-node-item ${currentPath === '/workflow-details' ? 'active' : ''}`} onClick={() => navigateTo('/workflow-details')}>Workflow Details</button>
              <button className={`nav-node-item ${currentPath === '/complaints' ? 'active' : ''}`} onClick={() => navigateTo('/complaints')}>Complaints</button>
              <button className={`nav-node-item ${currentPath === '/profile' ? 'active' : ''}`} onClick={() => navigateTo('/profile')}>Profile</button>
            </>
          )}
          <hr className="sidebar-divider-line" />
          <button className="nav-node-item logout-action-btn" onClick={onLogout}>
            🚪 Logout
          </button>
        </nav>
      </aside>

      {/* MASTER WORKSPACE PANE */}
      <main className={`master-workspace-content-pane ${isSidebarOpen ? 'sidebar-shifted' : ''}`}>
        {children}
      </main>

      {/* CENTER-SCREEN POPUP QUEUE - shows one at a time, regardless of page */}
      {activePopup && (
        <NotificationPopup popup={activePopup} onClose={handlePopupClose} />
      )}
    </div>
  );
}

export default Layout;