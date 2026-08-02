import React, { useState, useEffect } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';

const PermissionRequests = ({ onPendingCountChange } = {}) => {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [processedRequests, setProcessedRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Filter Search & Selector States
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState('All');
  const [tierFilter, setTierFilter] = useState('All');

  // Destructive Protection Modal State
  const [modalConfig, setModalConfig] = useState({ isOpen: false, requestId: null, action: '' });

  useEffect(() => {
    fetchRequestsWorkspace();
  }, []);

  // Keep the parent (Settings tab badge / sidebar) in sync with the live pending count
  useEffect(() => {
    if (typeof onPendingCountChange === 'function') {
      onPendingCountChange(pendingRequests.length);
    }
  }, [pendingRequests, onPendingCountChange]);

  // Helper utility to inject JWT authorization signatures into requests safely
  const getAuthHeaders = (contentType = 'application/json') => {
    const token = localStorage.getItem('token');
    const headers = {};
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchRequestsWorkspace = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/requests/all`, {
        method: 'GET',
        headers: getAuthHeaders(null) // No content-type needed for simple GET operations
      });
      
      if (!response.ok) {
        if (response.status === 401) throw new Error('Session expired. Please re-authenticate.');
        throw new Error('Failed to synchronize Request Center entries.');
      }
      
      const data = await response.json();
      setPendingRequests(data.pending || []);
      setProcessedRequests(data.processed || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerAction = (requestId, action) => {
    if (action === 'Rejected') {
      // Intercept with verification modal before execution
      setModalConfig({ isOpen: true, requestId, action });
    } else {
      executeRequestTransaction(requestId, action);
    }
  };

  const executeRequestTransaction = async (requestId, action) => {
    setActionLoading(true);
    setModalConfig({ isOpen: false, requestId: null, action: '' });
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/requests/process/${requestId}`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ action })
      });

      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 401) throw new Error('Unauthorized operational execution signature.');
        throw new Error(errData.error || 'Failed to execute structural matrix update.');
      }

      // Dynamic UI Refresh: Instantly restructure locally tracked record state arrays
      let movedRecord = null;
      setPendingRequests(prev => {
        const targetIndex = prev.findIndex(r => r.id === requestId);
        if (targetIndex !== -1) {
          movedRecord = { ...prev[targetIndex], status: action };
          return prev.filter(r => r.id !== requestId);
        }
        return prev;
      });

      if (movedRecord) {
        setProcessedRequests(prev => [movedRecord, ...prev]);
      }
    } catch (err) {
      alert(`Transaction Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Evaluation filtering hooks
  const filteredPending = pendingRequests.filter(req => {
    const matchesSearch = req.staff_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = moduleFilter === 'All' || req.requested_module === moduleFilter;
    const matchesTier = tierFilter === 'All' || req.requested_tier.toLowerCase() === tierFilter.toLowerCase();
    return matchesSearch && matchesModule && matchesTier;
  });

  // Extracted unique modules list dynamically with 'Customer Profile' included for filter options list
  const distinctModules = [
    'Customer Profile', 
    'Site Visit', 
    'Payment Flow', 
    'Bank Loan', 
    'MNRE Profile', 
    'KSEB Feasibility', 
    'Material Delivery', 
    'Material Installation', 
    'KSEB Registration', 
    'DCR Details', 
    'MNRE Installation', 
    'Service'
  ];

  return (
    <div className="customers-view-container" style={{ padding: 0 }}>
      {error && <div className="matrix-error-banner">⚠️ {error}</div>}

      {/* FILTER PANEL AND SYSTEM SEARCH HEADER */}
      <div className="control-filter-panel">
        <input 
          type="text" 
          className="search-bar-input"
          placeholder="🔍 Search Staff Name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="dropdown-controls-group">
          <select className="control-select-dropdown" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="All">All Modules</option>
            {distinctModules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="control-select-dropdown" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="All">All Tiers</option>
            <option value="view">View</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="table-loader-container"><div className="table-spinner"></div><p>Syncing Request Center...</p></div>
      ) : (
        <>
          {/* PENDING REQUEST INBOX */}
          <div className="sidebar-header-title" style={{ borderRadius: '6px 6px 0 0', border: '1px solid #e2e8f0', borderBottom: 'none' }}>
            <h3 style={{ color: '#ca8a04' }}>📥 PENDING REQUEST INBOX</h3>
          </div>
          <div className="table-responsive-wrapper" style={{ borderRadius: '0 0 6px 6px', marginBottom: '32px' }}>
            <table className="directory-data-grid">
              <thead>
                <tr>
                  <th>Req ID</th>
                  <th>Staff Name</th>
                  <th>Requested Module</th>
                  <th>Requested Tier</th>
                  <th>Request Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-directory-fallback" style={{ textAlign: 'center', padding: '24px' }}>
                      No open access level override requests queued.
                    </td>
                  </tr>
                ) : (
                  filteredPending.map((req) => (
                    <tr key={req.id} className="directory-data-row">
                      <td className="monospace-text bold-text-highlight">REQ-{String(req.id).padStart(3, '0')}</td>
                      <td style={{ fontWeight: 600 }}>{req.staff_name}</td>
                      <td>{req.requested_module}</td>
                      <td>
                        <span className="monospace-code-badge" style={{ textTransform: 'uppercase', color: '#2563eb' }}>{req.requested_tier}</span>
                      </td>
                      <td>{req.request_date}</td>
                      <td>
                        <span className="status-badge-token status-site-visit">[Pending]</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-action-edit" 
                            onClick={() => handleTriggerAction(req.id, 'Approved')}
                            disabled={actionLoading}
                            style={{ padding: '4px 12px', fontSize: '0.8rem', borderRadius: '4px' }}
                          >
                            Approve
                          </button>
                          <button 
                            className="btn-action-delete"
                            onClick={() => handleTriggerAction(req.id, 'Rejected')}
                            disabled={actionLoading}
                            style={{ padding: '4px 8px', fontSize: '0.8rem', borderRadius: '4px' }}
                          >
                            ✖
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* DESTRUCTIVE ACTION CONFIRMATION OVERLAY */}
      <ConfirmationModal 
        isOpen={modalConfig.isOpen}
        onCancel={() => setModalConfig({ isOpen: false, requestId: null, action: '' })}
        onConfirm={() => executeRequestTransaction(modalConfig.requestId, modalConfig.action)}
        isLoading={actionLoading}
        title="Confirm Permission Rejection"
        message="Are you certain you want to deny this staff access tier upgrade request? This will archive the notification record instantly."
      />
    </div>
  );
};

export default PermissionRequests;