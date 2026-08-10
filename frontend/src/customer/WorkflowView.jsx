import React, { useState, useEffect } from 'react';
import { FaSearch, FaUser, FaCheckCircle, FaTools, FaFolderOpen,FaProjectDiagram } from 'react-icons/fa';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

// Order + display config for the 10 work_done-based modules. `key` must
// match the keys returned by GET /api/workflow-status/<customer_id>/
const WORKFLOW_MODULES = [
  { key: 'site_visit', label: 'Site Visit', link: 'site-visit' },
  { key: 'mnre_profile', label: 'MNRE Profile', link: 'mnre-profile' },
  { key: 'payment', label: 'Payment Flow', link: 'payment-flow' },
  { key: 'bank_loan', label: 'Bank Loan', link: 'bank-loan' },
  { key: 'kseb', label: 'KSEB Feasibility', link: 'kseb' },
  { key: 'material_delivery', label: 'Material Delivery', link: 'material-delivery' },
  { key: 'material_installation', label: 'Installation Logs', link: 'installation' },
  { key: 'kseb_registration', label: 'KSEB Reg & Completion', link: 'completion' },
  { key: 'dcr', label: 'DCR Compliance', link: 'dcr' },
  { key: 'mnre_installation', label: 'MNRE Installation', link: 'mnre-installation' }
];

function WorkflowView() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchCustomers = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${API_BASE}/documents/customers`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setCustomers(Array.isArray(data) ? data : data.customers || []);
        }
      } catch (err) {
        console.error('Failed to fetch customers for workflow view:', err);
      } finally {
        setLoadingCustomers(false);
      }
    };
    fetchCustomers();
  }, []);

  const handleSelectCustomer = async (customer) => {
    setSelectedCustomer(customer);
    setLoadingWorkflow(true);
    setError(null);
    const token = localStorage.getItem('token');
    const customerId = customer.customer_id || customer.consumer_id || customer.id;
    try {
      const res = await fetch(`${API_BASE}/workflow/${customerId}/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWorkflow(data.workflow || null);
      } else {
        setWorkflow(null);
        setError('Workflow status could not be loaded.');
      }
    } catch (err) {
      console.error('Failed to fetch workflow status:', err);
      setWorkflow(null);
      setError('Workflow status could not be loaded.');
    } finally {
      setLoadingWorkflow(false);
    }
  };

  const handleNavigationRedirect = (tabLink) => {
    if (!selectedCustomer) return;
    const customerId = selectedCustomer.customer_id || selectedCustomer.consumer_id || selectedCustomer.id;
    const path = `/customer-profile/${customerId}?tab=${tabLink}`;
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('popstate'));
  };

  const filteredCustomers = customers.filter(c =>
    String(c.customer_name || c.full_name || c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(c.customer_id || c.consumer_id || c.phone_number || c.phone || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="customers-view-container">
      {/* <div className="dashboard-view-header"> */}
        <div className="profile-header-summary-card">
          
        <h2>📋 Customer Workflow</h2>
        </div>
        <p className="welcome-back-text">Track per-module progress and pending items for each customer.</p>
  

      <div className="document-vault-grid">

        {/* LEFT COLUMN: Customer Selection List */}
        <div className="profile-details-content-card customer-list-pane">
          <div className="customer-search-box">
            <FaSearch style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '36px' }}
            />
          </div>

          <div className="customer-scrollable-list">
            {loadingCustomers ? (
              <div className="table-loader-fallback">Loading customers...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="empty-directory-fallback">No customers found</div>
            ) : (
              filteredCustomers.map(customer => {
                const isSelected = (selectedCustomer?.id ?? selectedCustomer?.customer_id) === (customer.id ?? customer.customer_id);
                const displayName = customer.customer_name || customer.full_name || customer.name || 'Unnamed Customer';
                const displayId = customer.customer_id || customer.consumer_id || customer.id;

                return (
                  <div
                    key={customer.id || customer.customer_id}
                    onClick={() => handleSelectCustomer(customer)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      background: isSelected ? '#eff6ff' : '#ffffff',
                      border: isSelected ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
                      transition: 'var(--transition)',
                      marginBottom: '8px'
                    }}
                  >
                    <div style={{ fontWeight: '600', color: isSelected ? '#1d4ed8' : 'var(--text-main)', fontSize: '0.925rem' }}>
                      {displayName}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      <span>ID: {displayId}</span>
                      {customer.phone_number && <span>{customer.phone_number}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Workflow Diagram */}
        <div className="profile-details-content-card">
          {!selectedCustomer ? (
            <div className="centered-placeholder-box" style={{ minHeight: '350px' }}>
              <FaFolderOpen size={48} color="#cbd5e1" style={{ marginBottom: '12px' }} />
              <div className="placeholder-primary-msg">Select a customer from the left list to view their workflow progress.</div>
            </div>
          ) : loadingWorkflow ? (
            <div className="table-loader-container">
              <div className="table-spinner"></div>
              <p>Loading workflow status...</p>
            </div>
          ) : error ? (
            <div className="table-error-fallback">⚠️ {error}</div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div className="profile-fallback-avatar" style={{ width: '40px', height: '40px', fontSize: '18px' }}><FaUser /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--secondary)' }}>
                    {selectedCustomer.customer_name || selectedCustomer.full_name || selectedCustomer.name}
                  </h3>
                  <span className="monospace-text" style={{ fontSize: '0.85rem' }}>
                    Consumer Reference: {selectedCustomer.customer_id || selectedCustomer.consumer_id || 'N/A'}
                  </span>
                </div>
              </div>

              {/* 10 work_done-based modules, as cards showing status + pending items */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                {WORKFLOW_MODULES.map(mod => {
                  const data = workflow?.[mod.key];
                  const isCompleted = data?.status === 'Completed';
                  const pending = data?.pending || [];

                  return (
                    <div
                      key={mod.key}
                      onClick={() => handleNavigationRedirect(mod.link)}
                      style={{
                        border: `1px solid ${isCompleted ? '#bbf7d0' : '#fecaca'}`,
                        background: isCompleted ? '#f0fdf4' : '#fef2f2',
                        borderRadius: 'var(--radius-md)',
                        padding: '14px',
                        cursor: 'pointer',
                        transition: 'var(--transition)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>{mod.label}</span>
                        {isCompleted && <FaCheckCircle color="#22c55e" size={16} />}
                      </div>

                      {isCompleted ? (
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#16a34a' }}>Workflow Completed</div>
                      ) : (
                        <div style={{ fontSize: '0.78rem', color: '#b91c1c' }}>
                          <strong>Pending:</strong>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                            {pending.map((item, i) => <li key={i}>{item}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Service module: not Completed/Pending — shows count by type */}
                {workflow?.service && (
                  <div
                    onClick={() => handleNavigationRedirect('service')}
                    style={{
                      border: '1px solid #bfdbfe',
                      background: '#eff6ff',
                      borderRadius: 'var(--radius-md)',
                      padding: '14px',
                      cursor: 'pointer',
                      transition: 'var(--transition)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Service</span>
                      <FaTools color="#2563eb" size={15} />
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1d4ed8', marginBottom: '6px' }}>
                      Total Services: {workflow.service.total}
                    </div>
                    {Object.keys(workflow.service.counts).length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No service records yet</div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.78rem', color: 'var(--text-main)' }}>
                        {Object.entries(workflow.service.counts).map(([type, count]) => (
                          <li key={type}>{type}: {count}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default WorkflowView;