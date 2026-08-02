import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import ForgotPassword from './components/Forgotpassword';
import ResetPassword from './components/ResetPassword';
import AdminDashboard from './admin/AdminDashboard';
import StaffDashboard from './staff/StaffDashboard';
import CustomersView from './customer/CustomersView';
import CustomerProfile from './customer/CustomerProfile';
import Settings from './admin/Settings';
import { useAuth } from './context/AuthContext';
import DocumentsView from './customer/DocumentsView';
import ProfileView from './staff/ProfileView';
import WorkflowView from './customer/WorkflowView';
import Supplements from './components/Supplements';
import ComplaintsPage from './components/Complaints';

function ProtectedRoute({ isAllowed, fallback, children }) {
  return isAllowed ? children : fallback;
}

// Shared route content for both dashboards, so routes are defined once
// instead of duplicated between the admin and staff blocks.
function DashboardContent({ currentPath, role }) {
  if (currentPath === '/') {
    return role === 'admin' ? (
      <div className="dashboard-placeholder-view">
        <h2>Admin Dashboard Overview Panel</h2>
        <p>Welcome to your system administration overview panel workspace.</p>
      </div>
    ) : (
      <div className="dashboard-placeholder-view">
        <h2>Staff Dashboard Performance Logs</h2>
        <p>Welcome to your personal work tracking panel workspace.</p>
      </div>
    );
  }

  if (currentPath === '/customers') return <CustomersView />;

  if (currentPath.startsWith('/customer-profile/')) {
    const customerId = currentPath.split('/customer-profile/')[1];
    return <CustomerProfile customerId={customerId} />;
  }

  if (currentPath === '/documents') return <DocumentsView />;
  if (currentPath === '/profile') return <ProfileView />;
  if (currentPath === '/workflow-details') return <WorkflowView />;
  if (currentPath === '/supplements') return <Supplements />;
  if (currentPath === '/complaints') return <ComplaintsPage />;

  // Admin-only route
  if (currentPath === '/settings') {
    return role === 'admin' ? <Settings /> : null;
  }

  return (
    <div className="dashboard-placeholder-view">
      <h2>Page not found</h2>
      <p>The page you're looking for doesn't exist.</p>
    </div>
  );
}

function App() {
  const { role, user, login, logout } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const handleLoginSuccess = (userRole, token, userData) => {
    login(userRole, token, userData);
    navigateTo('/');
  };

  const handleLogout = () => {
    logout();
    navigateTo('/');
  };

  if (!role) {
    if (currentPath === '/forgot-password') {
      return <ForgotPassword onBackToLogin={() => navigateTo('/')} />;
    }

    if (currentPath.startsWith('/reset-password/')) {
      const token = currentPath.split('/reset-password/')[1];
      return <ResetPassword token={token} onResetSuccess={() => navigateTo('/')} />;
    }

    return (
      <Login
        onLoginSuccess={handleLoginSuccess}
        onForgotPassword={() => navigateTo('/forgot-password')}
      />
    );
  }

  // Guard against an unrecognized role (e.g. a new/typo'd role from the
  // backend) instead of silently rendering a blank page.
  if (role !== 'admin' && role !== 'staff') {
    return (
      <div className="dashboard-placeholder-view">
        <h2>Unauthorized</h2>
        <p>Your account role isn't recognized. Please contact an administrator.</p>
        <button onClick={handleLogout}>Log out</button>
      </div>
    );
  }

  return (
    <>
      <ProtectedRoute isAllowed={role === 'admin'} fallback={null}>
        <AdminDashboard
          user={user}
          role={role}
          onLogout={handleLogout}
          currentPath={currentPath}
          navigateTo={navigateTo}
        >
          <DashboardContent currentPath={currentPath} role="admin" />
        </AdminDashboard>
      </ProtectedRoute>

      <ProtectedRoute isAllowed={role === 'staff'} fallback={null}>
        <StaffDashboard
          user={user}
          role={role}
          onLogout={handleLogout}
          currentPath={currentPath}
          navigateTo={navigateTo}
        >
          <DashboardContent currentPath={currentPath} role="staff" />
        </StaffDashboard>
      </ProtectedRoute>
    </>
  );
}

export default App;