import React, { useState, useEffect } from 'react';
import { FaEdit, FaCamera, FaSave, FaTimes, FaUser, FaPhone, FaEnvelope } from 'react-icons/fa';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB - safely under Cloudinary's 10MB cap
const MAX_IMAGE_DIMENSION = 800; // px, longest side after resize

const ProfileView = ({ onProfileUpdated }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Toggle state between View and Edit mode
  const [isEditing, setIsEditing] = useState(false);

  // Form input states bound to profile.py backend fields
  const [formData, setFormData] = useState({
    full_name: '',
    phone_number: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg');

  useEffect(() => {
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/profile/me`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.status === 401) {
        localStorage.clear();
        window.location.reload();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        setFormData({
          full_name: data.full_name || '',
          phone_number: data.phone_number || ''
        });
        if (data.profile_photo) {
          setImagePreview(data.profile_photo);
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.msg || 'Failed to load profile details.');
      }
    } catch (err) {
      console.error('Profile fetch error:', err);
      setError('A network error occurred while loading profile data.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Resize/re-encode an image client-side so large camera photos don't get
  // rejected by Cloudinary's upload size limit. Returns a new File object.
  const compressImage = (file, maxDimension = MAX_IMAGE_DIMENSION, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img;

          if (width > height && width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Image compression failed'));
                return;
              }
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, '') + '.jpg',
                { type: 'image/jpeg' }
              );
              resolve(compressedFile);
            },
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      e.target.value = '';
      return;
    }

    setCompressing(true);
    try {
      let finalFile = file;

      // Only compress if it's actually large - avoid unnecessary work on small files
      if (file.size > MAX_UPLOAD_SIZE) {
        finalFile = await compressImage(file);

        // If it's still too big after compression (rare), reject it
        if (finalFile.size > MAX_UPLOAD_SIZE) {
          setError(
            `Image is still too large after compression (${(finalFile.size / 1024 / 1024).toFixed(1)}MB). Please choose a smaller photo.`
          );
          e.target.value = '';
          setCompressing(false);
          return;
        }
      }

      setSelectedFile(finalFile);
      setImagePreview(URL.createObjectURL(finalFile));
    } catch (err) {
      console.error('Image processing error:', err);
      setError('Failed to process the selected image. Please try a different file.');
      e.target.value = '';
    } finally {
      setCompressing(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSelectedFile(null);
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        phone_number: profile.phone_number || ''
      });
      if (profile.profile_photo) {
        setImagePreview(profile.profile_photo);
      }
    }
    setError('');
    setSuccessMessage('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      // Construct multipart/form-data payload compatible with profile.py
      const payload = new FormData();
      payload.append('full_name', formData.full_name);
      payload.append('phone_number', formData.phone_number);
      if (selectedFile) {
        payload.append('profile_photo', selectedFile);
      }

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/profile/me`, {
        method: 'PUT',
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('token')}`
        },
        body: payload
      });

      const resData = await response.json();

      if (response.ok && resData.success) {
        setProfile(resData.data);
        setIsEditing(false);
        setSelectedFile(null);
        // setSuccessMessage('Profile updated successfully!');
        if (resData.data.profile_photo) {
          setImagePreview(resData.data.profile_photo);
        }
        // Let the parent (wherever `user` state lives, e.g. App.jsx) know,
        // so Layout's sidebar picks up the new name/photo immediately.
        if (onProfileUpdated) {
          onProfileUpdated(resData.data);
        }
      } else {
        setError(resData.message || 'Failed to update profile records.');
      }
    } catch (err) {
      console.error('Profile update error:', err);
      setError('A network error occurred while saving profile changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="pv-wrapper">
        <div className="pv-card">
          <div className="table-loader-container">
            <div className="table-spinner"></div>
            <p>Loading User Profile...</p>
          </div>
        </div>
      </div>
    );
  }

  const roleLabel = profile?.role || 'Staff';

  return (
    <div className="pv-wrapper">
      <div className="pv-card">

        {/* Banner + overlapping avatar */}
        <div className="pv-banner">
          <div className="pv-avatar-wrap">
            <img src={imagePreview} alt="User Avatar" className="pv-avatar-img" />
            {isEditing && (
              <label htmlFor="profile_photo_upload" className="pv-avatar-upload-btn" title="Change photo">
                <FaCamera />
              </label>
            )}
            <input
              id="profile_photo_upload"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
          {compressing && (
            <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
              Processing image...
            </p>
          )}
        </div>

        <div className="pv-body">
          {/* Identity row */}
          <div className="pv-identity-row">
            <div>
              <h2 className="pv-name">{profile?.full_name || 'Staff User'}</h2>
              <p className="pv-email-line"><FaEnvelope /> {profile?.email || '—'}</p>
              <span className={`pv-role-pill role-${roleLabel.toLowerCase()}`}>{roleLabel}</span>
            </div>

            {!isEditing && (
              <button
                type="button"
                className="pv-edit-btn"
                onClick={() => { setIsEditing(true); setSuccessMessage(''); }}
              >
                <FaEdit />
              </button>
            
            )}
          </div>

          {/* Feedback Banners */}
          {error && <div className="auth-error">{error}</div>}
          {successMessage && (
            <div className="staff-message success" style={{ marginBottom: '20px' }}>
              {successMessage}
            </div>
          )}

          <div className="pv-divider" />

          {/* Main Form Display / Editor */}
          {!isEditing ? (
            /* VIEW MODE */
            <div className="pv-info-grid">
              <div className="pv-info-item">
                <span className="pv-info-icon"><FaUser /></span>
                <span className="pv-info-text">
                  <span className="pv-info-label">Full Name</span>
                  <span className="pv-info-value">{profile?.full_name || '—'}</span>
                </span>
              </div>
              <div className="pv-info-item">
                <span className="pv-info-icon"><FaEnvelope /></span>
                <span className="pv-info-text">
                  <span className="pv-info-label">Email Address</span>
                  <span className="pv-info-value">{profile?.email || '—'}</span>
                </span>
              </div>
              <div className="pv-info-item">
                <span className="pv-info-icon"><FaPhone /></span>
                <span className="pv-info-text">
                  <span className="pv-info-label">Phone Number</span>
                  <span className="pv-info-value">{profile?.phone_number || '—'}</span>
                </span>
              </div>
            </div>
          ) : (
            /* EDIT MODE */
            <form onSubmit={handleSave} className="pv-form-grid">
              <div className="pv-form-group">
                <label htmlFor="full_name" className="pv-form-label">Full Name</label>
                <input
                  type="text"
                  id="full_name"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleInputChange}
                  className="form-input"
                  required
                />
              </div>

              <div className="pv-form-group">
                <label htmlFor="phone_number" className="pv-form-label">Phone Number</label>
                <input
                  type="text"
                  id="phone_number"
                  name="phone_number"
                  value={formData.phone_number}
                  onChange={handleInputChange}
                  className="form-input"
                  required
                />
              </div>

              <div className="pv-form-actions">
                <button
                  type="button"
                  className="pv-btn-ghost"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Discard
                </button>
                <button
                  type="submit"
                  className="pv-btn-primary"
                  disabled={saving || compressing}
                >
                  <FaSave /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileView;