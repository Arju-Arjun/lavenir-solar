import React, { useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';

/**
 * AddStaff Component
 * Renders a structured registration workspace form to add a new staff profile.
 * Automatically handles navigation state redirection upon successful save or cancellation.
 */
const AddStaff = ({ onCancel }) => {
  // Local state container initialized to map perfectly to the database model fields
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone_number: '',
    password: '',
    department: '',
  });

  // UI state management layers for messaging notifications and async activity locks
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  /**
   * Captures character keystrokes and synchronizes individual text input targets
   * with the local component formData memory space.
   */
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Intercepts natural HTML form execution on submission and holds data dispatching,
   * triggering the security confirmation modal prompt overlay instead.
   */
  const handleFormSubmitClick = (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });
    setIsModalOpen(true);
  };

  /**
   * Asynchronously dispatches the local user profile payload data array 
   * to the backend Python Flask API endpoint using network fetch streams.
   */
  const handleConfirmSave = async () => {
    setIsModalOpen(false); // Close the confirmation overlay early to prevent multiple clicks
    setIsLoading(true);

    try {
      const response = await fetch('${import.meta.env.VITE_API_BASE_URL}//api/staff/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong during the save operation.');
      }

      // Display a operational success message banner to the user interface
      setMessage({ type: 'success', text: data.message || 'Staff member created successfully!' });
      
      // Wipe structural records inside state upon completion
      setFormData({
        full_name: '',
        email: '',
        phone_number: '',
        password: '',
        department: '',
      });

      // TRIGGER REDIRECT: Returns the layout back to StaffDirectory and forces a live list update
      if (onCancel) onCancel();

    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Formats local text input fields clean and triggers immediate view restoration
   * back to the core active personnel collection grid.
   */
  const handleCancelClick = () => {
    setFormData({
      full_name: '',
      email: '',
      phone_number: '',
      password: '',
      department: '',
    });
    setMessage({ type: '', text: '' });
    
    // TRIGGER REDIRECT: Closes the form panel and redirects to the Staff Directory
    if (onCancel) onCancel();
  };

  return (
    <div className="staff-container">
      <h2 className="staff-title">Add New Staff Member</h2>
      
      {/* Dynamic system feedback banner displays errors or success validations */}
      {message.text && (
        <div className={`staff-message ${message.type}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleFormSubmitClick}>
        {/* Full Name Input Block */}
        <div className="form-group">
          <label>Full Name *</label>
          <input 
            type="text" 
            name="full_name" 
            value={formData.full_name} 
            onChange={handleChange} 
            required 
          />
        </div>

        {/* Email Address Input Block */}
        <div className="form-group">
          <label>Email Address *</label>
          <input 
            type="email" 
            name="email" 
            value={formData.email} 
            onChange={handleChange} 
            required 
          />
        </div>

        {/* Login Password Input Block */}
        <div className="form-group">
          <label>Password *</label>
          <input 
            type="password" 
            name="password" 
            value={formData.password} 
            onChange={handleChange} 
            required 
          />
        </div>

        {/* Mobile Contact Phone Input Block with Regional Country Prefix */}
        <div className="form-group">
          <label>Phone Number</label>
          <div className="phone-input-container">
            <span className="phone-prefix">+91</span>
            <input 
              type="text" 
              name="phone_number" 
              value={formData.phone_number} 
              onChange={handleChange} 
            />
          </div>
        </div>

        {/* Corporate Department Workspace Allocation Input Block */}
        <div className="form-group">
          <label>Department</label>
          <input 
            type="text" 
            name="department" 
            value={formData.department} 
            onChange={handleChange} 
          />
        </div>

        {/* Action Button Controls Footer Grid */}
        <div className="form-actions">
          <button 
            type="button" 
            className="btn-cancel" 
            onClick={handleCancelClick}
            disabled={isLoading}
          >
            Cancel
          </button>
          
          <button 
            type="submit" 
            className="btn-save" 
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save Staff'}
          </button>
        </div>
      </form>

      {/* Security Shield Modal Box handles standard confirmation protocols */}
      <ConfirmationModal 
        isOpen={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onConfirm={handleConfirmSave}
        title="Confirm New Staff Creation"
        message={`Are you sure you want to save ${formData.full_name || 'this user'}? The unique Employee ID sequence string will be generated automatically via backend models.`}
      />
    </div>
  );
};

export default AddStaff;