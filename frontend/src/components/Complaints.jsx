import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FaEdit, FaTrashAlt, FaSpinner, FaPaperclip, FaTimes, FaClock } from 'react-icons/fa';
import ConfirmationModal from './ConfirmationModal';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const CATEGORIES = ['Technical', 'Billing', 'Service', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Reopened'];

const STATUS_CLASS = {
  Open: 'perm-status-pending',
  Assigned: 'status-mnre-profile',
  'In Progress': 'status-site-visit',
  Resolved: 'perm-status-approved',
  Closed: 'status-service-logs',
  Reopened: 'perm-status-rejected',
};

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const splitCategory = (cat) => {
  if (!cat || CATEGORIES.includes(cat)) return { category: cat || 'Other', categoryOther: '' };
  return { category: 'Other', categoryOther: cat };
};

const resolveCategoryPayload = (form) =>
  form.category === 'Other' && form.categoryOther.trim() ? form.categoryOther.trim() : form.category;

const formatDateTime = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const emptyCreateForm = {
  subject: '', description: '', category: 'Other', categoryOther: '', priority: 'Medium',
  district_snapshot: '', place_snapshot: '', assigned_to: '', files: [],
};

// --- Staff Picker Component ---
const StaffPicker = ({ staffOptions, value, onChange, placeholder = 'Click to pick a staff member…' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const selected = staffOptions.find((s) => String(s.id) === String(value));

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = staffOptions.filter((s) => (s.full_name || '').toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={wrapRef} className="staff-picker-wrap">
      <input
        type="text"
        value={open ? query : (selected ? selected.full_name : '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        placeholder={placeholder} autoComplete="off"
      />
      {!!value && !open && (
        <button type="button" className="staff-picker-clear-btn" onClick={() => onChange('')}>✕</button>
      )}
      {open && (
        <div className="staff-picker-dropdown">
          {filtered.length === 0 ? <div className="staff-picker-empty">No staff found.</div> : filtered.map((s) => (
            <div key={s.id} className="staff-picker-option" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(String(s.id)); setOpen(false); setQuery(''); }}>
              {s.full_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- SLA / Overdue Badge ---
const SlaBadge = ({ complaint }) => {
  if (!complaint.sla_due_at) return null;
  const dueLabel = formatDateTime(complaint.sla_due_at);
  return (
    <span className={`sla-badge${complaint.is_overdue ? ' overdue' : ''}`}>
      <FaClock size={11} /> {complaint.is_overdue ? 'Overdue' : `Due ${dueLabel}`}
    </span>
  );
};

// --- Attachment list (with individual delete) ---
const AttachmentList = ({ attachments, onDelete, deletingId }) => {
  if (!attachments || attachments.length === 0) {
    return <p className="complaint-empty-note">No files attached.</p>;
  }
  return (
    <div className="attachment-list">
      {attachments.map((a) => (
        <div key={a.id} className="attachment-chip">
          <a href={a.file_url} target="_blank" rel="noreferrer" className="attachment-chip-link">
            <FaPaperclip size={12} /> {a.file_name || 'Attachment'}
          </a>
          {onDelete && (
            <button
              type="button"
              className="attachment-remove-btn"
              onClick={() => onDelete(a.id)}
              disabled={deletingId === a.id}
              title="Remove attachment"
            >
              {deletingId === a.id ? <FaSpinner className="spin-icon" /> : <FaTimes size={11} />}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

// --- Comment thread ---
const CommentThread = ({ comments, onAdd, isUserAdmin, posting }) => {
  const [message, setMessage] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const submit = () => {
    if (!message.trim()) return;
    onAdd(message.trim(), isInternal);
    setMessage(''); setIsInternal(false);
  };

  return (
    <div className="comment-thread">
      {(!comments || comments.length === 0) ? (
        <p className="complaint-empty-note">No comments yet.</p>
      ) : (
        <div className="comment-list">
          {comments.map((c) => (
            <div key={c.id} className={`comment-item${c.is_internal ? ' internal' : ''}`}>
              <div className="comment-meta">
                <span className="comment-author">{c.user_name || 'User'}</span>
                {c.is_internal && <span className="comment-internal-tag">Internal</span>}
                <span className="comment-time">{formatDateTime(c.created_at)}</span>
              </div>
              <p className="comment-message">{c.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="comment-input-row">
        <textarea
          rows={2}
          placeholder="Write a comment or update…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="comment-input-actions">
          {isUserAdmin && (
            <label className="comment-internal-toggle">
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
              Internal note
            </label>
          )}
          <button type="button" className="btn-save" onClick={submit} disabled={posting || !message.trim()}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ComplaintsPage = () => {
  const { isAdmin, role } = useAuth();
  const isUserAdmin = isAdmin || role === 'admin';

  const [complaints, setComplaints] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortMode, setSortMode] = useState('pending_oldest');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewComplaint, setViewComplaint] = useState(null);
  const [editComplaint, setEditComplaint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const customerSearchTimer = useRef(null);

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState({
    subject: '', description: '', category: '', categoryOther: '', priority: '',
    district_snapshot: '', place_snapshot: '', status: '', resolution_notes: '', assigned_to: '',
  });

  const [newAttachmentFiles, setNewAttachmentFiles] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState(null);
  const [postingComment, setPostingComment] = useState(false);

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: sortMode });
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (overdueOnly) params.append('overdue', 'true');
      const res = await fetch(`${API_BASE}/api/complaints/all?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load complaints');
      const data = await res.json();
      setComplaints(data.complaints || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [statusFilter, categoryFilter, sortMode, overdueOnly]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  useEffect(() => {
    if (isUserAdmin) {
      fetch(`${API_BASE}/api/complaints/staff-list`, { headers: authHeaders() })
        .then(res => res.json())
        .then(data => setStaffOptions(data.staff || []))
        .catch(err => console.error("Failed to load staff list:", err));
    }
  }, [isUserAdmin]);

  useEffect(() => {
    return () => {
      if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    };
  }, []);

  const triggerCustomerSearch = async (queryText) => {
    try {
      const fetchQuery = queryText.trim() ? queryText : 'a';
      const res = await fetch(`${API_BASE}/api/complaints/customers-lookup?query=${encodeURIComponent(fetchQuery)}`, { headers: authHeaders() });
      const data = await res.json();
      setCustomerResults(data.customers || []);
    } catch { setCustomerResults([]); }
  };

  const handleCustomerQueryChange = (value) => {
    setCustomerQuery(value);
    setSelectedCustomer(null);
    setShowCustomerDropdown(true);
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    customerSearchTimer.current = setTimeout(() => triggerCustomerSearch(value), 300);
  };

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerQuery(customer.customer_name);
    setShowCustomerDropdown(false);

    setCreateForm((prev) => ({
      ...prev,
      district_snapshot: customer.district || '',
      place_snapshot: customer.place || '',
    }));
  };

  const resetCreateForm = () => {
    setCreateForm(emptyCreateForm);
    setCustomerQuery(''); setCustomerResults([]); setSelectedCustomer(null);
  };

  // Re-fetch a single complaint and patch it into whichever views are open,
  // plus the row in the list - used after attachment/comment mutations so we
  // don't have to duplicate their response shape everywhere.
  const refreshComplaintDetail = async (complaintId) => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints/${complaintId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const updated = await res.json();
      setComplaints((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setViewComplaint((prev) => (prev && prev.id === updated.id ? updated : prev));
      setEditComplaint((prev) => (prev && prev.id === updated.id ? updated : prev));
    } catch { /* silent - next full fetch will reconcile */ }
  };

  const handleCreateComplaint = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return setFormError('Select a customer first.');
    if (!createForm.subject.trim() || !createForm.description.trim()) return setFormError('Subject and description are required.');

    setSaving(true); setFormError('');
    try {
      const formData = new FormData();
      formData.append('customer_project_id', selectedCustomer.id);
      formData.append('subject', createForm.subject);
      formData.append('description', createForm.description);
      formData.append('category', resolveCategoryPayload(createForm));
      formData.append('priority', createForm.priority);
      formData.append('district_snapshot', createForm.district_snapshot);
      formData.append('place_snapshot', createForm.place_snapshot);

      if (isUserAdmin && createForm.assigned_to) formData.append('assigned_to', createForm.assigned_to);
      createForm.files.forEach((f) => formData.append('files', f));

      const res = await fetch(`${API_BASE}/api/complaints/create`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register complaint.');
      setShowCreateModal(false); resetCreateForm(); fetchComplaints();
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  const openView = (complaint) => { setViewComplaint(complaint); setFormError(''); };

  const openEdit = (complaint) => {
    const { category, categoryOther } = splitCategory(complaint.category);
    setEditComplaint(complaint);
    setEditForm({
      subject: complaint.subject, description: complaint.description, category, categoryOther, priority: complaint.priority,
      district_snapshot: complaint.district_snapshot || '', place_snapshot: complaint.place_snapshot || '',
      status: complaint.status, resolution_notes: complaint.resolution_notes || '', assigned_to: complaint.assigned_to || '',
    });
    setNewAttachmentFiles([]); setFormError('');
  };

  const handleEditSave = async () => {
    if (!editForm.subject.trim() || !editForm.description.trim()) return setFormError('Subject and description cannot be empty.');
    if (['Resolved', 'Closed'].includes(editForm.status) && !editForm.resolution_notes.trim()) return setFormError('Resolution notes required to resolve/close.');

    setSaving(true); setFormError('');
    try {
      const formData = new FormData();
      formData.append('subject', editForm.subject);
      formData.append('description', editForm.description);
      formData.append('category', resolveCategoryPayload(editForm));
      formData.append('priority', editForm.priority);
      formData.append('district_snapshot', editForm.district_snapshot);
      formData.append('place_snapshot', editForm.place_snapshot);
      formData.append('status', editForm.status);
      formData.append('resolution_notes', editForm.resolution_notes);

      if (isUserAdmin && editForm.assigned_to) formData.append('assigned_to', editForm.assigned_to);

      const res = await fetch(`${API_BASE}/api/complaints/${editComplaint.id}/edit`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update complaint.');

      setEditComplaint(null); fetchComplaints();
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  const handleUploadAttachments = async () => {
    if (!editComplaint || newAttachmentFiles.length === 0) return;
    setUploadingAttachment(true); setFormError('');
    try {
      const formData = new FormData();
      newAttachmentFiles.forEach((f) => formData.append('files', f));
      const res = await fetch(`${API_BASE}/api/complaints/${editComplaint.id}/attachments`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload attachment(s).');
      setNewAttachmentFiles([]);
      await refreshComplaintDetail(editComplaint.id);
    } catch (err) { setFormError(err.message); }
    finally { setUploadingAttachment(false); }
  };

  const handleDeleteAttachment = async (attachmentId) => {
    const complaintId = editComplaint?.id || viewComplaint?.id;
    if (!complaintId) return;
    setDeletingAttachmentId(attachmentId);
    try {
      await fetch(`${API_BASE}/api/complaints/${complaintId}/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await refreshComplaintDetail(complaintId);
    } catch (err) { setFormError(err.message); }
    finally { setDeletingAttachmentId(null); }
  };

  const handleAddComment = async (message, isInternal) => {
    const complaintId = editComplaint?.id || viewComplaint?.id;
    if (!complaintId) return;
    setPostingComment(true);
    try {
      const res = await fetch(`${API_BASE}/api/complaints/${complaintId}/comments`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, is_internal: isInternal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add comment.');
      await refreshComplaintDetail(complaintId);
    } catch (err) { setFormError(err.message); }
    finally { setPostingComment(false); }
  };

  const triggerDeleteConfirmation = (complaint) => {
    setModalConfig({ isOpen: true, title: 'Delete Complaint', message: `Delete ${complaint.complaint_number}?`, onConfirm: () => handleDeleteComplaint(complaint.id) });
  };

  const handleDeleteComplaint = async (complaintId) => {
    setModalConfig((prev) => ({ ...prev, isOpen: false })); setSaving(true);
    try {
      await fetch(`${API_BASE}/api/complaints/${complaintId}`, { method: 'DELETE', headers: authHeaders() });
      fetchComplaints();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="customer-profile-master-pane">
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .global-loader-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255, 255, 255, 0.7); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 1.2rem; }
      `}</style>

      {saving && !showCreateModal && !editComplaint && (
        <div className="global-loader-overlay"><FaSpinner style={{ animation: 'spin 1s linear infinite', fontSize: '3rem', color: '#3b82f6' }} /><span>Processing...</span></div>
      )}

      {/* Control Panel / Headers */}
      <div className="profile-header-summary-card"><h2>📋 Complaints</h2></div>

      <div className="profile-tab-content-viewport">
        <div className="control-filter-panel">
          <div className="dropdown-controls-group">
            <select className="control-select-dropdown" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <select className="control-select-dropdown" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">All Categories</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <select className="control-select-dropdown" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="pending_oldest">Sort: Oldest Pending First</option>
              <option value="newest">Sort: Newest First</option>
              <option value="priority">Sort: Priority</option>
              <option value="overdue">Sort: Overdue First</option>
            </select>
            <label className="overdue-filter-toggle">
              <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
          </div>
          <button className="btn-save" onClick={() => setShowCreateModal(true)}>+ Register New</button>
        </div>

        {error && <div className="table-error-fallback">{error}</div>}

        {loading ? (
          <div className="table-loader-fallback" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' }}><FaSpinner style={{ animation: 'spin 1s linear infinite', fontSize: '2rem' }} /><span>Loading…</span></div>
        ) : complaints.length === 0 ? (
          <div className="empty-directory-fallback">No complaints found.</div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="table-responsive-wrapper desktop-only-table">
              <table className="directory-data-grid">
                <thead>
                  <tr><th>Complaint #</th><th>Customer</th><th>Subject</th><th>Priority</th><th>Status</th><th>SLA</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {complaints.map((c) => (
                    <tr key={c.id} className="directory-data-row" onClick={() => openView(c)} style={{ cursor: 'pointer' }}>
                      <td className="monospace-text">{c.complaint_number}</td>
                      <td><div className="bold-text-highlight">{c.customer_name}</div></td>
                      <td>{c.subject}</td>
                      <td><span className="perm-status-badge">{c.priority}</span></td>
                      <td><span className={`perm-status-badge ${STATUS_CLASS[c.status] || ''}`}>{c.status}</span></td>
                      <td><SlaBadge complaint={c} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="action-view-button" onClick={() => openEdit(c)} style={{ marginRight: '8px' }}><FaEdit /></button>
                        <button className="btn-action-delete" onClick={() => triggerDeleteConfirmation(c)} style={{ color: 'var(--error)', background: 'transparent', border: 'none', cursor: 'pointer' }}><FaTrashAlt /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list - shown instead of the table on small screens */}
            {/* <div className="complaints-mobile-cards mobile-only-cards">
              {complaints.map((c) => (
                <div key={c.id} className="complaint-mobile-card" onClick={() => openView(c)}>
                  <div className="complaint-mobile-card-top">
                    <span className="monospace-text">{c.complaint_number}</span>
                    <span className={`perm-status-badge ${STATUS_CLASS[c.status] || ''}`}>{c.status}</span>
                  </div>
                  <div className="bold-text-highlight complaint-mobile-card-customer">{c.customer_name}</div>
                  <div className="complaint-mobile-card-subject">{c.subject}</div>
                  <div className="complaint-mobile-card-badges">
                    <span className="perm-status-badge">{c.priority}</span>
                    <SlaBadge complaint={c} />
                  </div>
                  <div className="complaint-mobile-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="action-view-button" onClick={() => openEdit(c)}><FaEdit /> Edit</button>
                    <button className="btn-action-delete" onClick={() => triggerDeleteConfirmation(c)}><FaTrashAlt /> Delete</button>
                  </div>
                </div>
              ))}
            </div> */}
          </>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="staff-modal-overlay" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
          <div className="staff-container" onClick={(e) => e.stopPropagation()} style={{ width: 650, maxWidth: '95vw' }}>
            <h3 className="staff-title">Register New Complaint</h3>
            {formError && <div className="staff-message error">{formError}</div>}
            <form onSubmit={handleCreateComplaint}>
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Customer</label>
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(e) => handleCustomerQueryChange(e.target.value)}
                  onFocus={() => { setShowCustomerDropdown(true); if (!customerQuery) triggerCustomerSearch(''); }}
                  placeholder="Search customer by name or ID..."
                  autoComplete="off"
                />
                {showCustomerDropdown && (
                  <div className="customer-lookup-dropdown">
                    {customerResults.length === 0 ? (
                       <div className="customer-lookup-empty">No customers found.</div>
                    ) : (
                       customerResults.map((cust) => (
                        <div
                          key={cust.id}
                          className="customer-lookup-option"
                          onClick={() => handleSelectCustomer(cust)}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <div className="customer-lookup-option-name">
                            {cust.customer_name} <span className="customer-lookup-option-id">({cust.customer_id})</span>
                          </div>
                          <div className="customer-lookup-option-location">
                            📍 {[cust.place, cust.district].filter(Boolean).join(', ') || 'No location saved'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {selectedCustomer && (
                <div className="form-row-flex">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>District</label>
                    <input
                      type="text"
                      value={createForm.district_snapshot}
                      onChange={(e) => setCreateForm({ ...createForm, district_snapshot: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Place</label>
                    <input
                      type="text"
                      value={createForm.place_snapshot}
                      onChange={(e) => setCreateForm({ ...createForm, place_snapshot: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="form-row-flex">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Category</label>
                  <select className="control-select-dropdown" style={{ width: '100%' }} value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Priority</label>
                  <select className="control-select-dropdown" style={{ width: '100%' }} value={createForm.priority} onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              {createForm.category === 'Other' && (
                <div className="form-group"><label>Specify Category</label><input type="text" value={createForm.categoryOther} onChange={(e) => setCreateForm({ ...createForm, categoryOther: e.target.value })} /></div>
              )}

              <div className="form-group"><label>Subject</label><input type="text" value={createForm.subject} onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })} /></div>
              <div className="form-group"><label>Description</label><textarea rows={3} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} style={{ width: '100%' }} /></div>

              {isUserAdmin && (
                <div className="form-group">
                  <label>Assign To (Admin Only)</label>
                  <StaffPicker
                    staffOptions={staffOptions}
                    value={createForm.assigned_to}
                    onChange={(id) => setCreateForm({ ...createForm, assigned_to: id })}
                    placeholder="Search staff to assign..."
                  />
                </div>
              )}

              <div className="form-group">
                <label>Attach Files (Optional)</label>
                <input type="file" multiple onChange={(e) => setCreateForm({ ...createForm, files: Array.from(e.target.files) })} />
                {createForm.files.length > 0 && (
                  <p className="file-picked-note">{createForm.files.length} file(s) selected</p>
                )}
              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => { setShowCreateModal(false); resetCreateForm(); }} disabled={saving}>Cancel</button>
                <button type="submit" className="btn-save" disabled={saving}>{saving ? 'Saving...' : 'Register Complaint'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editComplaint && (
        <div className="staff-modal-overlay" onClick={() => setEditComplaint(null)}>
          <div className="staff-container" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxWidth: '95vw' }}>
            <h3 className="staff-title">Edit {editComplaint.complaint_number}</h3>
            {formError && <div className="staff-message error">{formError}</div>}

            <div className="form-group"><label>Subject</label><input type="text" value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} /></div>
            <div className="form-group"><label>Description</label><textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} style={{ width: '100%' }} /></div>

            <div className="form-row-flex">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Priority</label>
                <select className="control-select-dropdown" style={{ width: '100%' }} value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Status</label>
                <select className="control-select-dropdown" style={{ width: '100%' }} value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {isUserAdmin && (
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Assign To (Admin Only)</label>
                  <StaffPicker
                    staffOptions={staffOptions}
                    value={editForm.assigned_to}
                    onChange={(id) => setEditForm({ ...editForm, assigned_to: id })}
                  />
                </div>
              )}
            </div>

            <div className="complaint-meta-badges-row">
              <SlaBadge complaint={editComplaint} />
              {editComplaint.reopen_count > 0 && (
                <span className="reopen-badge">Reopened {editComplaint.reopen_count}×</span>
              )}
            </div>

            <div className="form-group">
              <label>Resolution Notes {['Resolved', 'Closed'].includes(editForm.status) && <span style={{ color: 'red' }}>*</span>}</label>
              <textarea rows={2} value={editForm.resolution_notes} onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })} style={{ width: '100%' }} />
            </div>

            <div className="form-group">
              <label>Attachments</label>
              <AttachmentList
                attachments={editComplaint.attachments}
                onDelete={handleDeleteAttachment}
                deletingId={deletingAttachmentId}
              />
              <div className="attachment-upload-row">
                <input type="file" multiple onChange={(e) => setNewAttachmentFiles(Array.from(e.target.files))} />
                <button
                  type="button"
                  className="btn-save"
                  onClick={handleUploadAttachments}
                  disabled={uploadingAttachment || newAttachmentFiles.length === 0}
                >
                  {uploadingAttachment ? 'Uploading…' : 'Add File(s)'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Comments</label>
              <CommentThread
                comments={editComplaint.comments}
                onAdd={handleAddComment}
                isUserAdmin={isUserAdmin}
                posting={postingComment}
              />
            </div>

            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setEditComplaint(null)} disabled={saving}>Cancel</button>
              <button className="btn-save" onClick={handleEditSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {viewComplaint && (
        <div className="staff-modal-overlay" onClick={() => setViewComplaint(null)}>
          <div className="staff-container" onClick={(e) => e.stopPropagation()} style={{ width: 650, maxWidth: '95vw' }}>
            <h3 className="staff-title">Complaint: {viewComplaint.complaint_number}</h3>

            <div className="complaint-meta-badges-row">
              <span className={`perm-status-badge ${STATUS_CLASS[viewComplaint.status] || ''}`}>{viewComplaint.status}</span>
              <span className="perm-status-badge">Priority: {viewComplaint.priority}</span>
              <span className="perm-status-badge">Category: {viewComplaint.category}</span>
              <SlaBadge complaint={viewComplaint} />
              {viewComplaint.reopen_count > 0 && (
                <span className="reopen-badge">Reopened {viewComplaint.reopen_count}×</span>
              )}
            </div>

            <div className="form-row-flex">
              <div className="form-group" style={{ flex: 1 }}>
                <label>Customer Details</label>
                <p className="complaint-detail-line"><strong>Name:</strong> {viewComplaint.customer_name}</p>
                <p className="complaint-detail-line">
                  <strong>Location:</strong> {[viewComplaint.place_snapshot, viewComplaint.district_snapshot].filter(Boolean).join(', ') || 'N/A'}
                </p>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Assigned Staff</label>
                <p className="complaint-assignee-name">
                  {viewComplaint.assigned_staff_name || 'Unassigned'}
                </p>
              </div>
            </div>

            <div className="form-group">
              <label>Subject</label>
              <p style={{ fontWeight: 500 }}>{viewComplaint.subject}</p>
            </div>

            <div className="form-group">
              <label>Description</label>
              <p className="complaint-body-text">{viewComplaint.description}</p>
            </div>

            {viewComplaint.resolution_notes && (
              <div className="form-group">
                <label>Resolution Notes</label>
                <p className="complaint-body-text resolution">{viewComplaint.resolution_notes}</p>
              </div>
            )}

            <div className="form-group">
              <label>Attached Files</label>
              <AttachmentList attachments={viewComplaint.attachments} />
            </div>

            <div className="form-group">
              <label>Comments</label>
              <CommentThread
                comments={viewComplaint.comments}
                onAdd={handleAddComment}
                isUserAdmin={isUserAdmin}
                posting={postingComment}
              />
            </div>

            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setViewComplaint(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal isOpen={modalConfig.isOpen} title={modalConfig.title} message={modalConfig.message} onConfirm={modalConfig.onConfirm} onCancel={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))} />
    </div>
  );
};

export default ComplaintsPage;