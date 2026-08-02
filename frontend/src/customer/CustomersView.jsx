import React, { useState, useEffect } from 'react';
import AddCustomer from './AddCustomer';
import AdvancedFilterPanel, { buildEmptyFilters, cleanFilters } from './AdvancedFilterPanel';

const SEARCH_DEBOUNCE_MS = 400;

export default function CustomersView() {
  // searchInput is what the text box shows; searchQuery is the debounced
  // value that actually triggers a fetch, so we don't hit the API on
  // every keystroke.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('created_date');

  // Nested advanced filters (Profile, Site Visit, Bank Loan, KSEB, etc).
  // Replaces the old single "status" dropdown, which only ever matched
  // CustomerProject.project_status and couldn't express per-module state.
  const [advancedFilters, setAdvancedFilters] = useState(buildEmptyFilters());
  const [appliedFilters, setAppliedFilters] = useState(buildEmptyFilters());
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Maps backend field keys directly to operational flow visuals
  const workflowStages = [
    { key: 'sitevisit_work_done', label: 'Site Visit', link: 'site-visit' },
    { key: 'mnreprofile_work_done', label: 'MNRE Profile', link: 'mnre-profile' },
    { key: 'payment_work_done', label: 'Payment Flow', link: 'payment-flow' },
    { key: 'bankloan_work_done', label: 'Bank Loan', link: 'bank-loan' },
    { key: 'kseb_work_done', label: 'KSEB Feasibility', link: 'kseb' },
    { key: 'materialdelivery_work_done', label: 'Material Delivery', link: 'material-delivery' },
    { key: 'materialinstallation_work_done', label: 'Installation Logs', link: 'installation' },
    { key: 'ksebregistrationcompletion_work_done', label: 'KSEB Reg & Completion', link: 'completion' },
    { key: 'dcrcertificate_work_done', label: 'DCR Compliance', link: 'dcr' },
    { key: 'mnreinstallation_work_done', label: 'MNRE Installation', link: 'mnre-installation' }
  ];

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        setLoading(true);
        setError(null);

        const queryParams = new URLSearchParams({
          search: searchQuery,
          sort_by: sortBy,
          sort_order: 'desc'
        });

        const cleaned = cleanFilters(appliedFilters);
        if (Object.keys(cleaned).length > 0) {
          queryParams.set('filters', JSON.stringify(cleaned));
        }

        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token && token !== 'null') {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/customers/?${queryParams.toString()}`, {
          method: 'GET',
          headers
        });

        if (response.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user_role');
          window.location.reload();
          return;
        }

        if (!response.ok) throw new Error(`Server returned status ${response.status}`);
        const result = await response.json();

        if (result.success && Array.isArray(result.data)) {
          setCustomers(result.data);
        } else if (Array.isArray(result)) {
          setCustomers(result);
        } else {
          setError(result.error || 'Failed to fetch directory elements.');
        }
      } catch (err) {
        setError(`Backend network communication mismatch: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, [searchQuery, sortBy, appliedFilters]);

  // Lock background scroll while the Add Customer modal is open, and let
  // Esc close it — standard modal ergonomics now that this is an overlay
  // instead of a full page swap.
  useEffect(() => {
    if (!showAddForm) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowAddForm(false);
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAddForm]);

  const handleRowClick = (id, event) => {
    if (event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
    setExpandedRowId(expandedRowId === id ? null : id);
  };

  const handleNavigationRedirect = (customerId, tabLink) => {
    const path = `/customer-profile/${customerId}?tab=${tabLink}`;
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('popstate'));
  };

  return (
    <div className="customers-view-container">
      <div className="profile-header-summary-card">
        <div>
          <h2>Customer Directory</h2>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>Track, audit, and dispatch system lifecycle deployment stages.</p>
        </div>
        <button className="edit-btn" onClick={() => setShowAddForm(true)}>➕ Add New Customer</button>
      </div>

      <div className="control-filter-panel">
        <input
          type="text"
          className="search-bar-input"
          placeholder="Search by Customer Name or Place..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <div className="dropdown-controls-group">
          <select className="control-select-dropdown" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="created_date">Sort by: Created Date</option>
            <option value="customer_name">Sort by: Customer Name</option>
          </select>
          <AdvancedFilterPanel
            filters={advancedFilters}
            onChange={setAdvancedFilters}
            isOpen={isFilterPanelOpen}
            onToggle={() => setIsFilterPanelOpen((open) => !open)}
            onApply={() => {
              setAppliedFilters(advancedFilters);
              setIsFilterPanelOpen(false);
            }}
            onClear={() => {
              const empty = buildEmptyFilters();
              setAdvancedFilters(empty);
              setAppliedFilters(empty);
            }}
          />
        </div>
      </div>

      {loading ? (
          <div className="table-loader-container">
            <div className="table-spinner"></div>
            <p>Loading project directory metrics...</p>
          </div>
        ) : error ? (
          <div className="table-error-fallback">⚠️ {error}</div>
        ) : (
          <div className="table-responsive-wrapper">
          <table className="directory-data-grid">
            <thead>
              <tr>
                <th>SL No</th>
                <th>Customer ID</th>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>District</th>
                <th>Place</th>
                <th>Capacity (kW)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan="8" className="empty-directory-fallback">No active records match.</td></tr>
              ) : (
                customers.map((customer, index) => {
                  const recordId = customer.customer_id;
                  const isExpanded = expandedRowId === recordId;

                  return (
                    <React.Fragment key={recordId}>
                      <tr className={`directory-data-row ${isExpanded ? 'active-expanded-row' : ''}`} onClick={(e) => handleRowClick(recordId, e)}>
                        <td>{customer.sl_no || index + 1}</td>
                        <td className="monospace-text">{customer.customer_id || 'N/A'}</td>
                        <td className="bold-text-highlight">{customer.customer_name || 'N/A'}</td>
                        <td>{customer.phone_number || 'N/A'}</td>
                        <td>{customer.district || 'N/A'}</td>
                        <td>{customer.place || 'N/A'}</td>
                        <td>{customer.capacity_kw ? `${customer.capacity_kw} kW` : '0 kW'}</td>
                        <td>
                          <button className="action-view-button" onClick={() => handleNavigationRedirect(recordId, 'profile')}>
                            View
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                       <tr className="accordion-drawer-row">
                        <td colSpan="8">
                          <div className="expanded-drawer-container">
                            <h4 className="drawer-section-title">Project Workflow Progress</h4>
                            <div className="horizontal-workflow-diagram">
                              {workflowStages.map((stage, idx) => {
                                // Evaluate completion state based on explicit backend properties
                                const isCompleted = customer[stage.key] === 'Completed';
                                const nodeStatusClass = isCompleted ? 'node-completed' : 'node-pending';

                                // Check if the current stage is Bank Loan
                                const isBankLoanStage = stage.label === 'Bank Loan' || stage.key === 'bankloan_work_done';

                                // Assuming your backend passes a 'need_loan' boolean.
                                // If need_loan is exactly false, we mark it as Not Required.
                                const isLoanNotRequired = isBankLoanStage && customer.need_loan === false;

                                return (
                                  <div
                                    key={stage.key}
                                    className={`workflow-node-block ${nodeStatusClass}`}
                                    onClick={() => handleNavigationRedirect(recordId, stage.link)}
                                  >
                                    <div className="node-marker-circle">{isCompleted ? '✓' : idx + 1}</div>
                                    <span className="node-text-label">{stage.label}</span>

                                    {/* Conditionally render "Not Required" text under Bank Loan */}
                                    {isLoanNotRequired && (
                                      <span className="node-sub-text" style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'block' }}>
                                        (Not Required)
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddForm && (
        <div className="customer-modal-overlay">
          <AddCustomer
            onCancel={() => setShowAddForm(false)}
            onSuccess={() => {
              setShowAddForm(false);
              window.location.reload();
            }}
          />
        </div>
      )}
    </div>
  );
}