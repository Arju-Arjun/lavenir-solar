import React, { useState, useEffect } from 'react';
// import AddNewStaff from './AddStaff';
import StaffDirectory from './StaffDirectory';
import PermissionManagement from './PermissionManagement';
import PermissionRequests from './PermissionRequests';
const Settings = () => {
  // Define active tabs matching the required settings modules
  const [activeTab, setActiveTab] = useState('staff-directory');
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  const tabs = [
    
    { id: 'staff-directory', label: 'Staff Directory' },
    { id: 'roles-permissions', label: 'Roles & Permissions Management' },
    { id: 'permission-requests', label: 'Permission Requests' },
  ];

  // Fetch the pending permission request count so the tab badge is accurate
  // even before the Permission Requests tab has been opened.
  useEffect(() => {
    const fetchPendingCount = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/requests/all`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setPendingRequestCount((data.pending || []).length);
        }
      } catch (err) {
        console.error('Failed to fetch pending permission request count:', err);
      }
    };
    fetchPendingCount();
  }, []);

  return (
    <div className="customer-profile-master-pane">
      {/* Settings Header Layout matching standard dashboards */}
      <div className="profile-header-summary-card">
        <div>
          <h2>⚙️ System Settings</h2>
          <p style={{ color: '#94a3b8', margin: '4px 0 0 0', fontSize: '0.9rem' }}>
            Configure company staff profiles, customize system clearance matrices, and authorize permission overrides.
          </p>
        </div>
      </div>

      {/* Submenu Tab Switcher Bar inherited from master layouts */}
      <div className="profile-tabs-navigation-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`profile-nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'permission-requests' && pendingRequestCount > 0 && (
              <span className="pending-count-badge">
                {pendingRequestCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Settings Display Pane Container */}
      <div className="profile-tab-content-viewport">
        
       

        {activeTab === 'staff-directory' && (
            <StaffDirectory />
        )}
        {activeTab === 'roles-permissions' && (
            <PermissionManagement />  
      )}


      {activeTab === 'permission-requests' && (
          <PermissionRequests onPendingCountChange={setPendingRequestCount} />
          )}
      </div>
    </div>
  );
};

export default Settings;