import React, { useState, useEffect } from 'react';
import { FaClipboardList, FaCheckCircle, FaMapMarkedAlt, FaKey, FaSpinner } from 'react-icons/fa';
import Layout from '../components/Layout';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

function authHeaders() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
}

function StaffDashboardHome({ user, navigateTo }) {
  const [pendingTasks, setPendingTasks] = useState({ count: 0, tasks: [] });
  const [completed, setCompleted] = useState({ total_completed: 0, breakdown: [] });
  const [districts, setDistricts] = useState([]);
  const [permRequests, setPermRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [tasksRes, completedRes, districtsRes, permsRes] = await Promise.all([
          fetch(`${API_BASE}/staff/dashboard/pending-tasks`, { headers: authHeaders() }),
          fetch(`${API_BASE}/staff/dashboard/completed-this-month`, { headers: authHeaders() }),
          fetch(`${API_BASE}/staff/dashboard/district-distribution`, { headers: authHeaders() }),
          fetch(`${API_BASE}/staff/dashboard/my-permission-requests`, { headers: authHeaders() }),
        ]);

        if (tasksRes.ok) setPendingTasks(await tasksRes.json());
        if (completedRes.ok) setCompleted(await completedRes.json());
        if (districtsRes.ok) setDistricts(await districtsRes.json());
        if (permsRes.ok) setPermRequests(await permsRes.json());
      } catch (err) {
        console.error('Failed to load staff dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  const maxDistrictCount = Math.max(1, ...districts.map(d => d.customer_count));

  if (loading) {
    return (
      <div className="chart-loading-state" style={{ minHeight: '200px' }}>
        <FaSpinner className="spin-icon" size={22} />
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard-view-header">
        <h2>Staff Dashboard Performance Logs</h2>
        <p className="welcome-back-text">Welcome back, {user?.full_name || 'Staff'}. Here's what's on your plate.</p>
      </div>

      {/* --- Top metric cards --- */}
      <div className="analytics-metrics-grid">
        <div className="metric-card">
          <div className="metric-card-icon accent-amber"><FaClipboardList /></div>
          <div className="metric-card-body">
            <h3>Pending Tasks</h3>
            <div className="metric-value">{pendingTasks.count}</div>
            <p>Across modules you have access to</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card-icon accent-green"><FaCheckCircle /></div>
          <div className="metric-card-body">
            <h3>Completed This Month</h3>
            <div className="metric-value">{completed.total_completed}</div>
            <p>Records you marked complete</p>
          </div>
        </div>
      </div>

      <div className="chart-card-grid">
        {/* --- Pending tasks list --- */}
        <div className="chart-card">
          <div className="chart-card-title"><FaClipboardList size={14} /> Pending Tasks</div>
          <div className="chart-card-body">
            {pendingTasks.tasks.length === 0 ? (
              <p className="welcome-back-text">Nothing pending right now. 🎉</p>
            ) : (
              pendingTasks.tasks.slice(0, 8).map((task, idx) => (
                <div
                  key={idx}
                  className="task-list-item"
                  style={{ cursor: task.customer_project_id ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (task.customer_project_id) navigateTo(`/customer-profile/${task.customer_project_id}`);
                  }}
                >
                  <div>
                    <div className="task-list-title">{task.customer_name || 'Unknown Customer'}</div>
                    <div className="task-list-sub">{task.module}</div>
                  </div>
                  <span className="perm-status-badge perm-status-pending">{task.status}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* --- My permission requests --- */}
        <div className="chart-card">
          <div className="chart-card-title"><FaKey size={14} /> My Permission Requests</div>
          <div className="chart-card-body">
            {permRequests.length === 0 ? (
              <p className="welcome-back-text">You haven't requested any module permissions yet.</p>
            ) : (
              permRequests.slice(0, 8).map((req) => (
                <div key={req.id} className="task-list-item">
                  <div>
                    <div className="task-list-title">{req.module_name}</div>
                    <div className="task-list-sub">{req.permission_type}</div>
                  </div>
                  <span className={`perm-status-badge perm-status-${(req.status || '').toLowerCase()}`}>
                    {req.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* --- District distribution --- */}
        <div className="chart-card">
          <div className="chart-card-title"><FaMapMarkedAlt size={14} /> Customers by District</div>
          <div className="chart-card-body">
            {districts.length === 0 ? (
              <p className="welcome-back-text">No customer data yet.</p>
            ) : (
              districts.slice(0, 8).map((d) => (
                <div key={d.district} className="district-bar-row">
                  <div className="district-bar-label">
                    <span>{d.district}</span>
                    <span>{d.customer_count}</span>
                  </div>
                  <div className="district-bar-track">
                    <div
                      className="district-bar-fill"
                      style={{ width: `${(d.customer_count / maxDistrictCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffDashboard({ user, role, onLogout, currentPath, navigateTo, children }) {
  return (
    <Layout user={user} role={role} onLogout={onLogout} currentPath={currentPath} navigateTo={navigateTo}>
      {currentPath === '/' ? <StaffDashboardHome user={user} navigateTo={navigateTo} /> : children}
    </Layout>
  );
}

export default StaffDashboard;