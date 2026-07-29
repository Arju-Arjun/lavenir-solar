import React, { useState, useEffect } from 'react';
import { FaFileAlt, FaDownload, FaFolderOpen } from 'react-icons/fa';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

const USE_STATIC_FILES = true;

const STATIC_SUPPLEMENT_FILES = [
  { name: 'Warranty Terms.pdf', url: '/assets/supplements/warranty-terms.pdf' },
  { name: 'Maintenance Guide.pdf', url: '/assets/supplements/maintenance-guide.pdf' },
  { name: 'Safety Certificate.pdf', url: '/assets/supplements/safety-certificate.pdf' }
];

function Supplements() {
  const [files, setFiles] = useState(USE_STATIC_FILES ? STATIC_SUPPLEMENT_FILES : []);
  const [loading, setLoading] = useState(!USE_STATIC_FILES);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (USE_STATIC_FILES) return;

    const fetchSupplements = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${API_BASE}/supplements`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setFiles(Array.isArray(data) ? data : data.files || []);
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

    fetchSupplements();
  }, []);

  return (
    <div className="supplement-main-container">
      <div className="supplement-header-block">
        <h2>Supplement Documents</h2>
        <p className="supplement-subtitle-text">Reference files and certificates available for download.</p>
      </div>

      <div className="supplement-content-card">
        {loading ? (
          <div className="supplement-loader-wrap">
            <div className="supplement-spinner-circle"></div>
            <p>Loading supplement documents...</p>
          </div>
        ) : error ? (
          <div className="supplement-error-notice">{error}</div>
        ) : files.length === 0 ? (
          <div className="supplement-empty-box">
            <FaFolderOpen size={48} className="supplement-empty-icon" />
            <div className="supplement-empty-msg">No supplement documents available yet.</div>
          </div>
        ) : (
          <div className="supplement-grid-deck">
            {files.map((fileObj, idx) => {
              const fileUrl = typeof fileObj === 'string' ? fileObj : fileObj?.url;
              const fileName = typeof fileObj === 'string' ? `Document ${idx + 1}` : (fileObj?.name || `Document ${idx + 1}`);
              if (!fileUrl) return null;
              const isPdf = fileUrl.toLowerCase().includes('.pdf');

              return (
                <div key={idx} className="supplement-card-tile">
                  <a href={fileUrl} target="_blank" rel="noreferrer" className="supplement-tile-link" title={fileName}>
                    {isPdf ? (
                      <div className="supplement-pdf-preview">
                        <FaFileAlt className="supplement-pdf-icon" size={28} />
                        <span className="supplement-pdf-name">{fileName}</span>
                      </div>
                    ) : (
                      <img src={fileUrl} alt={fileName} className="supplement-img-preview" />
                    )}
                  </a>
                  <a
                    href={fileUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="supplement-download-action-btn"
                    title="Download File"
                  >
                    <FaDownload size={10} />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Supplements;