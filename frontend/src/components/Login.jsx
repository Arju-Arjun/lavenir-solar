import React, { useState } from 'react';

function Login({ onLoginSuccess, onForgotPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        // Explicitly persist token in local storage for session stability across reloads
        if (data.token) {
          localStorage.setItem('access_token', data.token);
          localStorage.setItem('user_role', data.role);
        }
        
        onLoginSuccess(data.role, data.token, data.user);
      } else {
        setError(data.message || 'Login failed');
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
            <p className="auth-subtitle">Sign in to your account</p>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

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
          <div className="form-group">
            <label className="form-label">Password</label>
            <input 
              type="password" 
              className="form-input"
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="••••••••"
              required 
              disabled={loading}
            />
          </div>
          
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div className="auth-forgot-row">
            <button
              type="button"
              className="auth-forgot-link"
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </div>
      </div>
    </div>
  );
}

export default Login;