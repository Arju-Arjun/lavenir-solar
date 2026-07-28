import React, { useState, useEffect } from 'react';

const PermissionManagement = () => {
  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState(null);
  
  // Matrix Core Form States
  const [permissionsMatrix, setPermissionsMatrix] = useState({});
  const [initialMatrix, setInitialMatrix] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Mapped strictly to standard specifications with correct matching key parameters
  const systemModules = [
    { key: 'Customer Profile', label: 'CUSTOMER PROFILE' },
    { key: 'Site Visit', label: 'SITE VISIT' },
    { key: 'Payment Flow', label: 'PAYMENT FLOW' },
    { key: 'Bank Loan', label: 'BANK LOAN' },
    { key: 'MNRE Profile', label: 'MNRE PROFILE' },
    { key: 'KSEB Utility', label: 'KSEB FEASIBILITY' },
    { key: 'Material Delivery', label: 'MATERIAL DELIVERY' },
    { key: 'Installation Progress', label: 'MATERIAL INSTALLATION' },
    { key: 'KSEB Registration & Completion', label: 'KSEB REGISTRATION' },
    { key: 'DCR Details', label: 'DCR DETAILS' },
    { key: 'MNRE Installation', label: 'MNRE INSTALLATION' },
    { key: 'Service', label: 'SERVICE / MAINTENANCE' }
  ];

  useEffect(() => {
    fetchStaffList();
  }, []);

  const fetchStaffList = async () => {
    try {
      setLoadingStaff(true);
      setError(null);
      const token = localStorage.getItem('token');
      
      const response = await fetch('${import.meta.env.VITE_API_BASE_URL}//api/staff/all', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error(`Failed to synchronize directory records (Status: ${response.status}).`);
      const data = await response.json();
      setStaffList(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingStaff(false);
    }
  };

  const handleSelectStaff = async (staffMember) => {
    setSelectedStaff(staffMember);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/get/${staffMember.id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      let initialMatrixStructure = {};
      if (response.ok) {
        const data = await response.json();
        initialMatrixStructure = data.permissions_matrix || {};
      } else {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Session expired or administrative authorization missing.");
        }
      }
      
      const normalizedMatrix = {};
      systemModules.forEach(mod => {
        normalizedMatrix[mod.key] = {
          view: initialMatrixStructure[mod.key]?.view ?? true, 
          update: initialMatrixStructure[mod.key]?.update ?? false,
          delete: initialMatrixStructure[mod.key]?.delete ?? false
        };
      });

      setPermissionsMatrix(normalizedMatrix);
      setInitialMatrix(JSON.parse(JSON.stringify(normalizedMatrix)));
    } catch (err) {
      setError(err.message);
      resetToBaselineDefault();
    }
  };

  const resetToBaselineDefault = () => {
    const defaultState = {};
    systemModules.forEach(mod => {
      defaultState[mod.key] = { view: true, update: false, delete: false };
    });
    setPermissionsMatrix(defaultState);
    setInitialMatrix(defaultState);
  };

  const handleCheckboxChange = (moduleKey, tierKey) => {
    setPermissionsMatrix(prev => {
      const updatedModule = { ...prev[moduleKey] };
      updatedModule[tierKey] = !updatedModule[tierKey];

      if ((updatedModule.update || updatedModule.delete) && tierKey !== 'view') {
        updatedModule.view = true;
      }
      
      if (tierKey === 'view' && !updatedModule.view) {
        updatedModule.update = false;
        updatedModule.delete = false;
      }

      return { ...prev, [moduleKey]: updatedModule };
    });
  };

  const handleSelectAllToggle = (e) => {
    const isChecked = e.target.checked;
    const updatedMatrix = {};
    
    systemModules.forEach(mod => {
      updatedMatrix[mod.key] = {
        view: true, 
        update: isChecked,
        delete: isChecked
      };
    });
    setPermissionsMatrix(updatedMatrix);
  };

  const isAllChecked = systemModules.every(mod => {
    const rights = permissionsMatrix[mod.key] || {};
    return rights.view && rights.update && rights.delete;
  });

  const handleSavePermissions = async () => {
    if (!selectedStaff) return;
    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/update/${selectedStaff.id}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ permissions_matrix: permissionsMatrix })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to modify matrix database configuration (Status: ${response.status}).`);
      }

      alert('Authorization levels configuration updated successfully!');
      setInitialMatrix(JSON.parse(JSON.stringify(permissionsMatrix)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetChanges = () => {
    setPermissionsMatrix(JSON.parse(JSON.stringify(initialMatrix)));
  };

  return (
    <div className="permission-dashboard">
      <div className="staff-sidebar">
        <div className="sidebar-header-title">
          <h3>Existing Staff Directory</h3>
        </div>
        <div className="sidebar-scrollable-zone">
          {loadingStaff ? (
            <div className="matrix-placeholder-msg">Querying personnel records...</div>
          ) : staffList.length === 0 ? (
            <div className="matrix-placeholder-msg">No system operators enrolled.</div>
          ) : (
            <ul className="staff-node-list">
              {staffList.map((staff) => (
                <li 
                  key={staff.id} 
                  onClick={() => handleSelectStaff(staff)}
                  className={`directory-data-row ${selectedStaff?.id === staff.id ? 'active-expanded-row' : ''}`}
                  style={{ backgroundColor: selectedStaff?.id === staff.id ? '#ffd28f45' : 'transparent' }}
                >
                  <div className="staff-row-inner-flex">
                    <span className="staff-name-text">• {staff.full_name}</span>
                    <span className={`status-badge-token ${staff.status === 'Active' ? 'status-commissioning' : 'status-service-logs'}`}>
                      {staff.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sidebar-footer-stats">
          Total Records: {staffList.length}
        </div>
      </div>

      <div className="matrix-content">
        <div className="staff-identifiers-card">
          <h4 className="card-sub-caps-label">Staff Identifiers Panel</h4>
          {selectedStaff ? (
            <div className="identifiers-grid-row">
              <div>Name: <strong style={{ color: '#fbbf24' }}>{selectedStaff.full_name}</strong></div>
              <div>ID: <span className="monospace-code-badge">{selectedStaff.employee_id || 'N/A'}</span></div>
              <div>Dept: <strong>{selectedStaff.department || '—'}</strong></div>
              <div>Status: <span style={{ color: selectedStaff.status === 'Active' ? '#34d399' : '#f87171' }}>{selectedStaff.status}</span></div>
            </div>
          ) : (
            <div className="identifiers-fallback-text">
              No employee selected. Click anywhere on a staff record row within the left directory column viewport structure to activate tracking layers.
            </div>
          )}
        </div>

        <div className="matrix-table-viewport">
          <div className="matrix-title-master-row">
            <h3>PERMISSION MAPPING MODULES (12-Tab Core Engine Matrix)</h3>
            {selectedStaff && (
              <label className="master-select-all-label">
                <div className="permission-checkbox-wrapper">
                  <input 
                    type="checkbox" 
                    checked={isAllChecked}
                    onChange={handleSelectAllToggle}
                    className="permission-checkbox"
                  />
                </div>
                <strong>Select All Permissions</strong>
              </label>
            )}
          </div>

          {error && <div className="matrix-error-banner">⚠️ {error}</div>}

          {!selectedStaff ? (
            <div className="matrix-empty-dashed-box">
              Select a staff profile line node entry to map configuration layer checkboxes.
            </div>
          ) : (
            <div className="permission-table-container">
              <table className="permission-table">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>Component Module</th>
                    <th style={{ width: '55%' }}>Authorization Levels</th>
                  </tr>
                </thead>
                <tbody>
                  {systemModules.map((mod) => {
                    const currentRights = permissionsMatrix[mod.key] || { view: true, update: false, delete: false };
                    return (
                      <tr key={mod.key}>
                        <td className="module-label-column">
                          [{currentRights.view ? '✓' : ' '}] {mod.label}
                        </td>
                        <td>
                          <div className="checkbox-options-flex-group">
                            <label className="interactive-checkbox-label">
                              <div className="permission-checkbox-wrapper">
                                <input 
                                  type="checkbox" 
                                  checked={currentRights.view} 
                                  onChange={() => handleCheckboxChange(mod.key, 'view')}
                                  className="permission-checkbox"
                                />
                              </div>
                              View
                            </label>

                            <label className="interactive-checkbox-label">
                              <div className="permission-checkbox-wrapper">
                                <input 
                                  type="checkbox" 
                                  checked={currentRights.update} 
                                  onChange={() => handleCheckboxChange(mod.key, 'update')}
                                  className="permission-checkbox"
                                />
                              </div>
                              Update
                            </label>

                            <label className="interactive-checkbox-label">
                              <div className="permission-checkbox-wrapper">
                                {/* customer profile only showing delete option */}
                                {mod.key === 'Customer Profile' || mod.key === 'Service' && (
                                <input 
                                  type="checkbox" 
                                  checked={currentRights.delete} 
                                  onChange={() => handleCheckboxChange(mod.key, 'delete')}
                                  className="permission-checkbox"
                                />
                  )}
                              </div>
                             {mod.key === 'Customer Profile' && <span>Delete</span>}
                             {mod.key === 'Service' && <span>Delete</span>}
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="matrix-footer-action-bar">
          <button 
            className="cancel-btn" 
            onClick={handleResetChanges} 
            disabled={!selectedStaff || saving}
          >
            Reset Changes
          </button>
          
          <button 
            className="edit-btn" 
            onClick={handleSavePermissions}
            disabled={!selectedStaff || saving}
          >
            {saving ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="spinner-icon"></div> Saving...
              </div>
            ) : 'Save Permissions'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionManagement;