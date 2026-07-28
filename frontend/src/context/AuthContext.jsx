import React, { createContext, useState, useEffect, useContext } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [role, setRole] = useState(() => localStorage.getItem('user_role'));
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user_profile');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [permissions, setPermissions] = useState({});
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  const isAdmin = role && role.trim().toLowerCase() === 'admin';

  const fetchUserPermissionsMatrix = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setPermissions({});
      return;
    }
    
    try {
      setLoadingPermissions(true);
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/staff/permissions/user-matrix`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPermissions(data.permissions_matrix || {});
      }
    } catch (err) {
      console.error("Failed to fetch global permission matrix mapping:", err);
    } finally {
      setLoadingPermissions(false);
    }
  };

  const loginGlobalContext = (userRole, token, userData) => {
    setRole(userRole);
    setUser(userData);
    if (token) localStorage.setItem('token', token);
    localStorage.setItem('user_role', userRole);
    localStorage.setItem('user_profile', JSON.stringify(userData));
  };

  const logoutGlobalContext = () => {
    setRole(null);
    setUser(null);
    setPermissions({});
    localStorage.removeItem('token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_profile');
  };

  useEffect(() => {
    if (role) {
      fetchUserPermissionsMatrix();
    } else {
      setPermissions({});
    }
  }, [role]);

  return (
    <AuthContext.Provider value={{ 
      role, 
      user, 
      permissions, 
      isAdmin,
      loadingPermissions, 
      login: loginGlobalContext, 
      logout: logoutGlobalContext,
      refetchPermissions: fetchUserPermissionsMatrix
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);