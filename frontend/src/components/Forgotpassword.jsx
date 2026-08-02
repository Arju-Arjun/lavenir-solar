import React, { useState } from 'react';

function ForgotPassword({ onBackToLogin }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        setMessage(data.message || 'If that email is registered, a reset link has been sent.');
      } else {
        setError(data.message || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      setError('Cannot connect to the backend server!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <img
            src="/favicon/android-chrome-512x512.png"
            alt="Lavenir Solar"
            className="auth-brand-mark"
          />
          <div>
            <h1 className="auth-title">
              <span className="brand-text">Lavenir</span>{' '}
              <span className="brand-solar">Solar</span>
            </h1>
            <p className="auth-subtitle">Reset your password</p>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-success">{message}</div>}

        {!message && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                disabled={loading}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <div className="auth-forgot-row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onBackToLogin}
            className="auth-forgot-link"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;