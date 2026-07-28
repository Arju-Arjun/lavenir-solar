import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ListChecks, CheckCircle2, Clock3, Loader2, ShieldQuestion, LayoutGrid, BarChart3,
} from 'lucide-react';
import { staffDashboardApi } from '../utils/dashboardApi';

const STATUS_CLASS = {
  Pending: 'perm-status-pending',
  Approved: 'perm-status-approved',
  Rejected: 'perm-status-rejected',
};

function ChartLoader() {
  return (
    <div className="chart-loading-state">
      <Loader2 className="spin-icon" size={22} />
    </div>
  );
}

function StaffMyWorkTab({ tasks, completed, permissionRequests }) {
  return (
    <div className="staff-work-grid">
      <div className="chart-card">
        <h3 className="chart-card-title">
          <ListChecks size={16} /> Pending Tasks
        </h3>
        {!tasks ? (
          <div className="chart-loading-state" style={{ height: 160 }}><Loader2 className="spin-icon" size={22} /></div>
        ) : tasks.tasks.length === 0 ? (
          <p className="empty-directory-fallback">No pending tasks in the modules you have access to.</p>
        ) : (
          <ul className="task-list">
            {tasks.tasks.map((t, i) => (
              <li key={`${t.module}-${t.record_id}-${i}`} className="task-list-item">
                <div>
                  <p className="task-list-title">{t.customer_name || `Customer Project #${t.customer_project_id}`}</p>
                  <p className="task-list-sub">{t.module}</p>
                </div>
                <span className="status-badge-token status-site-visit">{t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="chart-card">
        <h3 className="chart-card-title">
          <CheckCircle2 size={16} /> My Completed This Month
        </h3>
        <div className="metric-value" style={{ marginBottom: '12px' }}>
          {completed ? completed.total_completed : '--'}
        </div>
        {!completed ? (
          <div className="chart-loading-state" style={{ height: 100 }}><Loader2 className="spin-icon" size={22} /></div>
        ) : completed.breakdown.length === 0 ? (
          <p className="empty-directory-fallback">Nothing completed yet this month.</p>
        ) : (
          <div className="pending-breakdown-list">
            {completed.breakdown.map((row) => (
              <div key={row.module} className="pending-breakdown-row">
                <span>{row.module}</span>
                <span className="pending-breakdown-count">{row.completed_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chart-card">
        <h3 className="chart-card-title">
          <ShieldQuestion size={16} /> My Permission Requests
        </h3>
        {!permissionRequests ? (
          <div className="chart-loading-state" style={{ height: 160 }}><Loader2 className="spin-icon" size={22} /></div>
        ) : permissionRequests.length === 0 ? (
          <p className="empty-directory-fallback">You haven't requested any additional permissions.</p>
        ) : (
          <ul className="task-list">
            {permissionRequests.map((r) => (
              <li key={r.id} className="task-list-item">
                <div>
                  <p className="task-list-title">{r.module_name}</p>
                  <p className="task-list-sub">{r.permission_type}</p>
                </div>
                <span className={`perm-status-badge ${STATUS_CLASS[r.status] || ''}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StaffAnalyticsTab({ districts }) {
  return (
    <div className="chart-card">
      <h3 className="chart-card-title">District-wise Customer Distribution</h3>
      <div className="chart-card-body" style={{ height: 320 }}>
        {districts ? (
          <ResponsiveContainer>
            <BarChart data={districts} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="district" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey="customer_count" name="Customers" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartLoader />}
      </div>
    </div>
  );
}

function StaffDashboard({ user, role, onLogout, currentPath, navigateTo, children }) {
  const [tab, setTab] = useState('mywork');
  const [tasks, setTasks] = useState(null);
  const [districts, setDistricts] = useState(null);
  const [completed, setCompleted] = useState(null);
  const [permissionRequests, setPermissionRequests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (currentPath !== '/') return;
    Promise.all([
      staffDashboardApi.pendingTasks().then(setTasks),
      staffDashboardApi.districtDistribution().then(setDistricts),
      staffDashboardApi.completedThisMonth().then(setCompleted),
      staffDashboardApi.myPermissionRequests().then(setPermissionRequests),
    ]).catch((e) => setError(e.message));
  }, [currentPath]);

  return (
    <Layout
      user={user}
      role={role}
      onLogout={onLogout}
      currentPath={currentPath}
      navigateTo={navigateTo}
    >
      {currentPath === '/' ? (
        <div className="dashboard-workspace-wrapper">
          <header className="dashboard-view-header">
            <h2>Field Operations Workspace</h2>
            <p className="welcome-back-text">
              Welcome back, {user?.full_name || 'Staff Member'} ({user?.department || 'Operations'} Department)
            </p>
          </header>

          {error && <div className="table-error-fallback">Failed to load dashboard data: {error}</div>}

          <div className="analytics-metrics-grid">
            <div className="metric-card">
              <div className="metric-card-icon accent-amber"><Clock3 size={22} /></div>
              <div className="metric-card-body">
                <h3>Pending Tasks</h3>
                <div className="metric-value">{tasks ? tasks.count : '--'}</div>
                <p>Awaiting Immediate Field Actions</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-icon accent-green"><CheckCircle2 size={22} /></div>
              <div className="metric-card-body">
                <h3>Completed This Month</h3>
                <div className="metric-value">{completed ? completed.total_completed : '--'}</div>
                <p>Resolved Project Milestones</p>
              </div>
            </div>
          </div>

          <div className="dashboard-tabs">
            <button
              className={`dashboard-tab-btn ${tab === 'mywork' ? 'active' : ''}`}
              onClick={() => setTab('mywork')}
            >
              <LayoutGrid size={16} /> My Work
            </button>
            <button
              className={`dashboard-tab-btn ${tab === 'analytics' ? 'active' : ''}`}
              onClick={() => setTab('analytics')}
            >
              <BarChart3 size={16} /> Analytics
            </button>
          </div>

          {tab === 'mywork' ? (
            <StaffMyWorkTab tasks={tasks} completed={completed} permissionRequests={permissionRequests} />
          ) : (
            <StaffAnalyticsTab districts={districts} />
          )}
        </div>
      ) : (
        children
      )}
    </Layout>
  );
}

export default StaffDashboard;