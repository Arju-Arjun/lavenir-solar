import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import AdminDashboard from './admin/AdminDashboard';
import StaffDashboard from './staff/StaffDashboard';
import CustomersView from './customer/CustomersView';
import CustomerProfile from './customer/CustomerProfile';
import Settings from './admin/Settings';
import { useAuth } from './context/AuthContext';
import DocumentsView from './customer/DocumentsView';

function ProtectedRoute({ isAllowed, fallback, children }) {
  if (!isAllowed) {
    return fallback;
  }
  return children;
}

function App() {
  const { role, user, login, logout } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };

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
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      {/* Protected Operations: Super Admin Workspace */}
      <ProtectedRoute isAllowed={role === 'admin'} fallback={null}>
        <AdminDashboard 
          user={user} 
          role={role} 
          onLogout={handleLogout} 
          currentPath={currentPath}
          navigateTo={navigateTo}
        >
          {currentPath === '/' && (
            <div className="dashboard-placeholder-view">
              <h2>Admin Dashboard Overview Panel</h2>
              <p>Welcome to your system administration overview panel workspace.</p>
            </div>
          )}
          {currentPath === '/customers' && <CustomersView />}
          {currentPath.startsWith('/customer-profile/') && <CustomerProfile />}
          {currentPath === '/settings' && <Settings />}
          {currentPath === '/documents' && <DocumentsView />}
        </AdminDashboard>
      </ProtectedRoute>

      {/* Protected Operations: Field Operations Staff Workspace */}
      <ProtectedRoute isAllowed={role === 'staff'} fallback={null}>
        <StaffDashboard 
          user={user} 
          role={role} 
          onLogout={handleLogout} 
          currentPath={currentPath}
          navigateTo={navigateTo}
        >
          {currentPath === '/' && (
            <div className="dashboard-placeholder-view">
              <h2>Staff Dashboard Performance Logs</h2>
              <p>Welcome to your personal work tracking panel workspace.</p>
            </div>
          )}
          {currentPath === '/customers' && <CustomersView />}
          {currentPath.startsWith('/customer-profile/') && <CustomerProfile />}
          {currentPath === '/documents' && <DocumentsView />}
        </StaffDashboard>
      </ProtectedRoute>
    </>
  );
}

export default App;