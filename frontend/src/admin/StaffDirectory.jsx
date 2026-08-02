import React, { useState, useEffect, useMemo } from 'react';
import AddStaff from './AddStaff';
import ConfirmationModal from '../components/ConfirmationModal';

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
);

const SuspendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
);

const ActivateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
);

const SortIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5h10"></path><path d="M11 9h7"></path><path d="M11 13h4"></path><path d="M3 17l3 3 3-3"></path><path d="M6 18V4"></path></svg>
);

const SORT_FIELDS = [
  { value: 'full_name', label: 'Name' },
  { value: 'employee_id', label: 'Employee ID' },
  { value: 'department', label: 'Department' },
  { value: 'status', label: 'Status' },
];

const StaffDirectory = () => {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [sortField, setSortField] = useState('full_name');
  const [sortOrder, setSortOrder] = useState('asc');

  const [activeEditingUser, setActiveEditingUser] = useState(null);
  const [editFormData, setEditFormData] = useState({
    full_name: '', email: '', phone_number: '', department: '', password: ''
  });
  
  const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', userId: null, data: null });
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStaffData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/all`);
      if (!response.ok) throw new Error('Failed to synchronize directory records.');
      const data = await response.json();
      setStaffList(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaffData(); }, []);

  // Lock background scroll while the Add Staff modal is open, and let Esc
  // close it — standard modal ergonomics now that this is an overlay
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

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  const openConfirmation = (type, userId, data = null) => {
    setModalConfig({ isOpen: true, type, userId, data });
  };

  const handleExecuteConfirmedAction = async () => {
    const { type, userId, data } = modalConfig;
    setModalConfig(prev => ({ ...prev, isOpen: false }));
    setActionLoading(true);

    let url = `${import.meta.env.VITE_API_BASE_URL}/api/staff/update/${userId}`;
    let options = { method: 'PUT', headers: { 'Content-Type': 'application/json' } };

    if (type === 'TOGGLE_STATUS') {
      options.body = JSON.stringify({ status: data === 'Active' ? 'Inactive' : 'Active' });
    } else if (type === 'SAVE_EDIT') {
      const payload = { ...editFormData };
      if (!payload.password || !payload.password.trim()) {
        delete payload.password;
      }
      options.body = JSON.stringify(payload);
    } else if (type === 'HARD_DELETE') {
      url = `${import.meta.env.VITE_API_BASE_URL}/api/staff/delete/${userId}`;
      options = { method: 'DELETE' };
    }

    try {
      const response = await fetch(url, options);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Operation failed.');

      // Local State Mutation Engine (Bypasses full server list fetch loops)
      if (type === 'SAVE_EDIT') {
        setStaffList(prevList => 
          prevList.map(member => 
            member.id === userId ? { ...member, ...result.staff } : member
          )
        );
        setActiveEditingUser(null);
      } 
      else if (type === 'TOGGLE_STATUS') {
        setStaffList(prevList => 
          prevList.map(member => 
            member.id === userId ? { ...member, status: data === 'Active' ? 'Inactive' : 'Active' } : member
          )
        );
      } 
      else if (type === 'HARD_DELETE') {
        setStaffList(prevList => prevList.filter(member => member.id !== userId));
        }

    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Departments derived live from the fetched staff list, so the dropdown
  // never goes stale as staff are added/edited with new department names.
  const departmentOptions = useMemo(() => {
    const unique = new Set(
      staffList
        .map(member => member.department)
        .filter(dept => dept && dept.trim() !== '')
    );
    return ['All', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [staffList]);

  const filteredStaff = staffList.filter(member => {
    const nameStr = member.full_name ? member.full_name.toLowerCase() : '';
    const idStr = member.employee_id ? member.employee_id.toLowerCase() : '';
    const emailStr = member.email ? member.email.toLowerCase() : '';
    const searchLow = searchTerm.toLowerCase();

    const matchesSearch = 
      nameStr.includes(searchLow) ||
      idStr.includes(searchLow) ||
      emailStr.includes(searchLow);
      
    const matchesDept = selectedDepartment === 'All' || member.department === selectedDepartment;
    const matchesStatus = selectedStatus === 'All' || member.status === selectedStatus;

    return matchesSearch && matchesDept && matchesStatus;
  });

  // Sort is applied on top of the filtered set, on a shallow copy so the
  // original staffList/filteredStaff arrays are never mutated in place.
  const sortedStaff = [...filteredStaff].sort((a, b) => {
    const aVal = (a[sortField] || '').toString().toLowerCase();
    const bVal = (b[sortField] || '').toString().toLowerCase();
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSortOrder = () => {
    setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div className="customers-view-container">
      <div className="profile-header-summary-card">
        <div>
          <h2>Staff Directory Management</h2>
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>Monitor and control system operational access parameters.</p>
        </div>
        <button className="edit-btn" onClick={() => setShowAddForm(true)}>➕ Add Staff Member</button>
      </div>

      <div className="control-filter-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <input 
          type="text" 
          className="search-bar-input" 
          placeholder="🔍 Search via Name, Employee ID, or Email..."
          value={searchTerm} 
          onChange={(e) => setSearchTerm(e.target.value)}
          autoComplete="off"
          name="staff_search_field"
          style={{ flex: '1 1 240px' }}
        />

        <select
          className="form-field-input"
          name="department_filter"
          value={selectedDepartment}
          onChange={(e) => setSelectedDepartment(e.target.value)}
          style={{ minWidth: '160px' }}
        >
          {departmentOptions.map(dept => (
            <option key={dept} value={dept}>{dept === 'All' ? 'All Departments' : dept}</option>
          ))}
        </select>

        <select
          className="form-field-input"
          name="status_filter"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          style={{ minWidth: '150px' }}
        >
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Suspended</option>
        </select>

      </div>

      {loading ? (
        <div className="table-loader-container"><div className="table-spinner"></div></div>
      ) : (
        <div className="table-responsive-wrapper">
          <table className="directory-data-grid">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Full Name</th>
                <th>Department</th>
                <th>Email Address</th>
                <th>Phone Number</th>
                {/* <th>Password</th> */}
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Management Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedStaff.length === 0 ? (
                <tr>
                  <td colSpan="8" className="empty-directory-fallback" style={{ textAlign: 'center', padding: '24px' }}>
                    No staff records found matching the search criteria.
                  </td>
                </tr>
              ) : (
                sortedStaff.map((member) => {
                  const isEditingRow = activeEditingUser === member.id;
                  const isCurrentTarget = modalConfig.userId === member.id;
                  
                  return (
                    <tr key={member.id} className={`directory-data-row ${isEditingRow ? 'active-expanded-row' : ''}`}>
                      <td className="monospace-text bold-text-highlight">{member.employee_id}</td>
                      <td>
                        {isEditingRow ? <input type="text" name="full_name" className="form-field-input" value={editFormData.full_name} onChange={handleEditChange} /> : member.full_name}
                      </td>
                      <td>
                        {isEditingRow ? <input type="text" name="department" className="form-field-input" value={editFormData.department} onChange={handleEditChange} /> : (member.department || '—')}
                      </td>
                      <td>
                        {member.email}
                      </td>
                      <td>
                        {isEditingRow ? (
                            <div className="phone-input-container">
                            <input 
                                type="text" 
                                name="phone_number" 
                                className="form-field-input" 
                                value={editFormData.phone_number} 
                                onChange={handleEditChange}
                                minLength="10"
                                maxLength="10"
                                pattern="[0-9]{10}"
                                title="Phone number must be exactly 10 digits" 
                            />
                            </div>
                        ) : (
                            // add condition and prefix
                            member.phone_number ? `+91 ${member.phone_number}` : '—'
                            
                        )}
                        </td>
                      {/* <td>
                        {isEditingRow ? (
                          <input 
                            type="password" 
                            name="password" 
                            className="form-field-input" 
                            placeholder="New Password" 
                            value={editFormData.password} 
                            onChange={handleEditChange}
                            autoComplete="new-password"
                          />
                        ) : <span style={{ color: '#94a3b8' }}>••••••••</span>}
                      </td> */}
                      <td>
                        <span className={`status-badge-token ${member.status === 'Active' ? 'status-commissioning' : 'status-service-logs'}`}>{member.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          {isEditingRow ? (
                            <>
                              <button 
                                className="btn-action-edit" 
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                                onClick={() => openConfirmation('SAVE_EDIT', member.id)}
                                disabled={actionLoading}
                              >
                                {actionLoading && isCurrentTarget && modalConfig.type === 'SAVE_EDIT' ? (
                                  <div className="spinner-icon" style={{ borderTopColor: '#fff' }}></div>
                                ) : 'Save'}
                              </button>
                              <button className="btn-action-cancel" onClick={() => setActiveEditingUser(null)} disabled={actionLoading}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn-action-edit" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} onClick={() => {
                                setActiveEditingUser(member.id);
                                setEditFormData({ 
                                  full_name: member.full_name || '', 
                                  department: member.department || '', 
                                  email: member.email || '', 
                                  phone_number: member.phone_number || '', 
                                //   password: '' 
                                });
                              }} disabled={actionLoading}>
                                <EditIcon /> Edit
                              </button>
                              
                              <button 
                                className="btn-action-cancel" 
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1' }} 
                                onClick={() => openConfirmation('TOGGLE_STATUS', member.id, member.status)}
                                disabled={actionLoading}
                              >
                                {actionLoading && isCurrentTarget && modalConfig.type === 'TOGGLE_STATUS' ? (
                                  <div className="spinner-icon" style={{ borderTopColor: 'var(--secondary)' }}></div>
                                ) : (
                                  <>
                                    {member.status === 'Active' ? <SuspendIcon /> : <ActivateIcon />}
                                    {member.status === 'Active' ? 'Suspend' : 'Activate'}
                                  </>
                                )}
                              </button>

                              <button 
                                className="btn-action-delete" 
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} 
                                onClick={() => openConfirmation('HARD_DELETE', member.id)}
                                disabled={actionLoading}
                              >
                                {actionLoading && isCurrentTarget && modalConfig.type === 'HARD_DELETE' ? (
                                  <div className="spinner-icon" style={{ borderTopColor: '#f71818' }}></div>
                                ) : (
                                  <>
                                    <DeleteIcon /> Delete
                                  </>
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddForm && (
        <div className="staff-modal-overlay">
          <AddStaff onCancel={() => { setShowAddForm(false); fetchStaffData(); }} />
        </div>
      )}

      <ConfirmationModal 
        isOpen={modalConfig.isOpen}
        onCancel={() => setModalConfig({ isOpen: false, type: '', userId: null, data: null })}
        onConfirm={handleExecuteConfirmedAction}
        isLoading={actionLoading}
        title={
          modalConfig.type === 'SAVE_EDIT' ? 'Confirm Profile Mutations' : 
          modalConfig.type === 'HARD_DELETE' ? '⚠️ Permanent Profile Removal' : 'Change Account Access Status'
        }
        message={
          modalConfig.type === 'SAVE_EDIT' ? 'Are you certain you wish to write these parameter updates to the configuration records?' :
          modalConfig.type === 'HARD_DELETE' ? 'Warning: This will permanently suspend this staff member profile from the active database tracking scope layers.' :
          `Are you sure you want to change this profile status to ${modalConfig.data === 'Active' ? 'Inactive' : 'Active'}?`
        }
      />
    </div>
  );
};

export default StaffDirectory;