import React, { useState, useEffect } from 'react';
import { FaFileAlt, FaDownload, FaFolderOpen, FaSearch, FaUser } from 'react-icons/fa';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

// Helper dictionary to map backend database module slugs to human-readable titles
const MODULE_TITLE_MAP = {
  profile: 'Customer Profile Photo',
  site_visit: 'Site Visit Records & Documents',
  mnre_profile: 'MNRE Profile & Feasibility',
  bank_loan: 'Bank Loan Acknowledgement',
  payment: 'Payment Receipts & Proofs',
  dcr: 'DCR Certificate',
  service: 'Service Records & Photos',
  material_delivery: 'Material Delivery Files',
  material_installation: 'Material Installation Files'
};

function DocumentsView() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [documentsData, setDocumentsData] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch customer list on mount using the new documents blueprint route
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
        console.error('Failed to fetch customers for documents view:', err);
      } finally {
        setLoadingCustomers(false);
      }
    };
    fetchCustomers();
  }, []);

  // Fetch all module documents when a customer is selected
  const handleSelectCustomer = async (customer) => {
    setSelectedCustomer(customer);
    setLoadingDocs(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE}/documents/${customer.id}/documents`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocumentsData(data || {});
      } else {
        setDocumentsData({});
      }
    } catch (err) {
      console.error('Failed to fetch customer documents:', err);
      setDocumentsData({});
    } finally {
      setLoadingDocs(false);
    }
  };

  const filteredCustomers = customers.filter(c => 
    String(c.full_name || c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(c.consumer_id || c.phone || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="customers-view-container">
      <div className="dashboard-view-header">
        <h2>Customer Document Vault</h2>
        <p className="welcome-back-text">Browse and download module-wise files, photos, and scanned records.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'flex-start', marginTop: '20px' }}>
        
        {/* LEFT COLUMN: Customer Selection List */}
        {/* LEFT COLUMN: Customer Selection List */}
<div className="profile-details-content-card customer-list-pane" style={{ padding: '16px' }}>
  <div style={{ position: 'relative', marginBottom: '16px' }}>
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

  <div className="customer-scrollable-list" style={{ maxHeight: '600px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
    {loadingCustomers ? (
      <div className="table-loader-fallback">Loading customers...</div>
    ) : filteredCustomers.length === 0 ? (
      <div className="empty-directory-fallback">No customers found</div>
    ) : (
      filteredCustomers.map(customer => {
        const isSelected = selectedCustomer?.id === customer.id;
        const displayName = customer.full_name || customer.name || 'Unnamed Customer';
        const displayId = customer.customer_id || customer.consumer_id || customer.id;
        
        return (
          <div 
            key={customer.id}
            onClick={() => handleSelectCustomer(customer)}
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              background: isSelected ? '#eff6ff' : '#ffffff',
              border: isSelected ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
              transition: 'var(--transition)'
            }}
          >
            {/* Name displayed prominently as requested */}
            <div style={{ fontWeight: '600', color: isSelected ? '#1d4ed8' : 'var(--text-main)', fontSize: '0.925rem' }}>
              {displayName}
            </div>
            {/* ID & Mobile details rendered below */}
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

        {/* RIGHT COLUMN: Module-wise Document Viewer Matrix */}
        <div className="profile-details-content-card">
          {!selectedCustomer ? (
            <div className="centered-placeholder-box" style={{ minHeight: '350px' }}>
              <FaFolderOpen size={48} color="#cbd5e1" style={{ marginBottom: '12px' }} />
              <div className="placeholder-primary-msg">Select a customer from the left list to view their document repository.</div>
            </div>
          ) : loadingDocs ? (
            <div className="table-loader-container">
              <div className="table-spinner"></div>
              <p>Fetching documents for {selectedCustomer.full_name || selectedCustomer.name}...</p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div className="profile-fallback-avatar" style={{ width: '40px', height: '40px', fontSize: '18px' }}><FaUser /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--secondary)' }}>{selectedCustomer.full_name || selectedCustomer.name}</h3>
                  <span className="monospace-text" style={{ fontSize: '0.85rem' }}>Consumer Reference: {selectedCustomer.consumer_id || 'N/A'}</span>
                </div>
              </div>

              {/* Render Sections per Module */}
              {(!documentsData || Object.keys(documentsData).length === 0) ? (
                <div className="empty-directory-fallback">No documents uploaded across modules for this customer yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {Object.entries(documentsData).map(([moduleName, files]) => {
                    if (!files || !Array.isArray(files) || files.length === 0) return null;
                    
                    const formattedModuleTitle = MODULE_TITLE_MAP[moduleName] || moduleName.replace(/_/g, ' ').toUpperCase();

                    return (
                      <div key={moduleName} className="document-vault-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                        <h4 className="vault-group-title" style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', marginBottom: '12px', fontSize: '0.95rem', color: '#334155' }}>
                          {formattedModuleTitle}
                        </h4>
                        <div className="payment-receipts-gallery-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                          {files.map((fileObj, idx) => {
                            const fileUrl = typeof fileObj === 'string' ? fileObj : fileObj?.url;
                            const fileName = typeof fileObj === 'string' ? `Document ${idx + 1}` : (fileObj?.name || `Document ${idx + 1}`);
                            if (!fileUrl) return null;
                            const isPdf = fileUrl.toLowerCase().includes('.pdf');

                            return (
                              <div key={idx} className="receipt-tile-container" style={{ width: '140px', height: '140px', position: 'relative' }}>
                                <a href={fileUrl} target="_blank" rel="noreferrer" className="receipt-tile-content-link" title={fileName} style={{ display: 'block', width: '100%', height: '100%' }}>
                                  {isPdf ? (
                                    <div className="receipt-pdf-fallback-frame" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px' }}>
                                      <FaFileAlt className="receipt-pdf-gallery-icon" size={28} color="#ef4444" style={{ marginBottom: '8px' }} />
                                      <span className="receipt-pdf-text-tag" style={{ fontSize: '0.75rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>{fileName}</span>
                                    </div>
                                  ) : (
                                    <img src={fileUrl} alt={fileName} className="receipt-gallery-medium-image" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                                  )}
                                </a>
                                {/* Download Action Button overlay */}
                                <a 
                                  href={fileUrl} 
                                  download 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="tile-floating-remove-btn" 
                                  style={{ position: 'absolute', top: '6px', right: '6px', background: '#2563eb', color: '#fff', borderRadius: '50%', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                  title="Download File"
                                >
                                  <FaDownload size={10} />
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default DocumentsView;