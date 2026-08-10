import React, { useState, useEffect } from 'react';
import { FaFileAlt, FaFileImage, FaDownload, FaEdit, FaTrash, FaPlus, FaSave, FaTimes } from 'react-icons/fa';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

function getExt(fileObj) {
  const source = fileObj?.name || fileObj?.url || '';
  const match = source.split('?')[0].split('.').pop();
  return match ? match.toUpperCase() : 'FILE';
}

function isImageFile(fileObj) {
  return /\.(png|jpe?g|gif|webp)$/i.test(fileObj?.url || fileObj?.name || '');
}

function Supplements() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState([]);
  const [newFile, setNewFile] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSupplements = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE}/supplements/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const fileList = Array.isArray(data) ? data : data.files || [];
        setFiles(fileList);
        setEditData(fileList);
      } else {
        setError('Failed to load supplement documents.');
      }
    } catch (err) {
      console.error('Failed to fetch supplement documents:', err);
      setError('Failed to load supplement documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSupplements();
  }, []);

  const handleFieldChange = (index, field, value) => {
    const updated = [...editData];
    updated[index][field] = value;
    setEditData(updated);
  };

  const handleDeleteExisting = (index) => {
    const updated = [...editData];
    updated.splice(index, 1);
    setEditData(updated);
  };

  const handleSaveChanges = async () => {
    setSaving(true);
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('documents', JSON.stringify(editData));

    if (newFile) {
      formData.append('new_file', newFile);
      formData.append('title', newTitle);
      formData.append('description', newDescription);
    }

    try {
      const res = await fetch(`${API_BASE}/supplements/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        setIsEditing(false);
        setNewFile(null);
        setNewTitle('');
        setNewDescription('');
        fetchSupplements();
      } else {
        alert('Failed to save changes.');
      }
    } catch (err) {
      console.error('Error saving supplement documents:', err);
      alert('Error saving changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dc-page">
      {/* <div className="dc-header-row"> */}
      <div>
        <div>
          {/* <h2>Supplement Documents</h2> */}
          <div className="profile-header-summary-card"><h2>📋 Supplement Documents</h2></div>
          
        </div>
        <div className="supplements-buttons">
          {!isEditing ? (
            <div className="supplement-action">
              <button onClick={() => setIsEditing(true)}>
                <FaEdit className="icon-mr-6" /> Edit
              </button>
            </div>
          ) : (
            <div className="supplement-action">
              <button onClick={handleSaveChanges} disabled={saving}>
                {saving ? 'Saving...' : <><FaSave className="icon-mr-6" /> save</>}
              </button>
              <button onClick={() => { setIsEditing(false); setEditData(files); }}>
                <FaTimes className="icon-mr-6" /> Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="dc-panel">
        {loading ? (
          <div className="dc-loading">
            <div className="dc-spinner"></div>
            <p>Loading supplement documents...</p>
          </div>
        ) : error ? (
          <div className="dc-error">{error}</div>
        ) : (!isEditing && files.length === 0) ? (
          <div className="dc-empty">
            <FaFileAlt size={32} />
            <p>No supplement documents available yet.</p>
          </div>
        ) : (
          <div className="dc-grid">
            {(!isEditing ? files : editData).map((fileObj, idx) => {
              const fileUrl = fileObj?.url;
              const fileName = fileObj?.name || `Document ${idx + 1}`;
              const fileDesc = fileObj?.description || '';
              const isImage = isImageFile(fileObj);
              if (!fileUrl) return null;

              return (
                <div key={idx} className="dc-card">
                  <div className="dc-cover-wrap">
                    <a href={fileUrl} target="_blank" rel="noreferrer" className="dc-cover-link" title={fileName}>
                      <div className="dc-cover">
                        <div className="dc-cover-fold"></div>
                        {isImage ? (
                          <img src={fileUrl} alt={fileName} className="dc-cover-img" />
                        ) : (
                          <>
                            <FaFileAlt className="dc-cover-icon" size={36} />
                            <span className="dc-cover-badge">{getExt(fileObj)}</span>
                          </>
                        )}
                      </div>
                    </a>
                    {!isEditing && (
                      <a href={fileUrl} download target="_blank" rel="noreferrer" className="dc-download-fab" title="Download File">
                        <FaDownload size={11} />
                      </a>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="dc-edit-fields">
                      <input
                        type="text"
                        value={fileObj.name || ''}
                        onChange={(e) => handleFieldChange(idx, 'name', e.target.value)}
                        placeholder="Document title"
                        className="form-input"
                      />
                      <textarea
                        value={fileObj.description || ''}
                        onChange={(e) => handleFieldChange(idx, 'description', e.target.value)}
                        placeholder="Enter description..."
                        className="form-input"
                      />
                      <button
                        className="btn-action-delete dc-delete-btn"
                        onClick={() => handleDeleteExisting(idx)}
                      >
                        <FaTrash className="icon-mr-6" /> Delete
                      </button>
                    </div>
                  ) : (
                    <div className="dc-info">
                      <h4 className="dc-title">{fileName}</h4>
                      <p className="dc-desc">{fileDesc || 'No description provided.'}</p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* New File Upload Template Card (+ Button) */}
            {isEditing && (
              <div className="dc-upload-tile">
                <label htmlFor="new-pdf-upload" className="dc-upload-label">
                  <div className="dc-upload-circle">
                    <FaPlus size={16} />
                  </div>
                  <span className="dc-upload-text">Upload New PDF</span>
                </label>
                <input
                  id="new-pdf-upload"
                  type="file"
                  accept=".pdf"
                  className="dc-upload-input"
                  onChange={(e) => setNewFile(e.target.files[0])}
                />
                {newFile && (
                  <div className="dc-upload-preview">
                    <span className="dc-upload-filename">Selected: {newFile.name}</span>
                    <input
                      type="text"
                      placeholder="Title for new PDF"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="form-input"
                    />
                    <textarea
                      placeholder="Description for new PDF"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      className="form-input"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Supplements;