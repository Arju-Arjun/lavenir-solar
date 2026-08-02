import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import {
  Loader2, LayoutGrid, Clock, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { staffDashboardApi } from '../utils/dashboardApi';

const PIE_COLORS = {
  pending: '#f59e0b',
  completed: '#16a34a',
};

const MODULE_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#f59e0b',
  '#16a34a', '#0891b2', '#64748b', '#ea580c', '#9333ea',
];

function ListLoader() {
  return (
    <div className="chart-loading-state">
      <Loader2 className="spin-icon" size={22} />
    </div>
  );
}

function EmptyState({ message }) {
  return <p className="staff-empty-state">{message}</p>;
}

function ChartCard({ title, headerRight, children }) {
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3 className="chart-card-title">{title}</h3>
        {headerRight}
      </div>
      <div className="chart-card-body staff-card-body">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                        SUMMARY CARDS (with dropdowns)                      */
/* -------------------------------------------------------------------------- */

function SummaryCard({ icon: Icon, accentClass, label, count, rows, rowKey }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="metric-card staff-summary-card">
      <button
        type="button"
        className="staff-summary-card-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className={`metric-card-icon ${accentClass}`}>
          <Icon size={22} />
        </div>
        <div className="metric-card-body">
          <h3>{label}</h3>
          <div className="metric-value">{count}</div>
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && (
        <div className="staff-summary-card-dropdown">
          {(!rows || rows.length === 0) ? (
            <EmptyState message="No modules assigned to you yet." />
          ) : (
            rows.map((r) => (
              <div key={r.module} className="staff-summary-card-row">
                <span>{r.module}</span>
                <span>{r[rowKey]}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCards({ summary }) {
  if (!summary) {
    return (
      <div className="analytics-metrics-grid">
        <ListLoader />
      </div>
    );
  }

  const { total_assigned_modules, total_pending, total_complete } = summary.cards;

  return (
    <div className="analytics-metrics-grid">
      <SummaryCard
        icon={LayoutGrid}
        accentClass="accent-slate"
        label="Total Assigned Modules"
        count={total_assigned_modules.count}
        rows={total_assigned_modules.modules}
        rowKey="total"
      />
      <SummaryCard
        icon={Clock}
        accentClass="accent-amber"
        label="Total Pending"
        count={total_pending.count}
        rows={total_pending.modules}
        rowKey="pending"
      />
      <SummaryCard
        icon={CheckCircle2}
        accentClass="accent-gold"
        label="Total Complete"
        count={total_complete.count}
        rows={total_complete.modules}
        rowKey="completed"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                     INTERACTIVE PIE CHART (Total/Pending/Complete)         */
/* -------------------------------------------------------------------------- */

// Plain SVG donut chart — no external chart library required, so it renders
// regardless of what's already installed in the project. The data shape
// (staffDashboardApi.summary().pie_chart) is ready to feed Chart.js or
// recharts instead, if the project already standardizes on one of those.
function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function PieChart({ slices }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <EmptyState message="No data to chart yet." />;
  }

  const nonZeroSlices = slices.filter((s) => s.value > 0);

  // When exactly one slice holds 100% of the total, start===end at 360°
  // wrap around to the same point, so the arc path degenerates to a single
  // point instead of a filled donut. Draw a plain full circle instead of
  // going through arcPath for that one case.
  let angle = 0;
  const paths = nonZeroSlices.map((s) => {
    const pct = (s.value / total) * 100;
    if (nonZeroSlices.length === 1) {
      return { ...s, pct, isFullCircle: true };
    }
    const sweep = (s.value / total) * 360;
    const path = arcPath(110, 110, 100, angle, angle + sweep);
    angle += sweep;
    return { ...s, path, pct };
  });

  return (
    <div className="staff-pie-wrapper">
      <svg viewBox="0 0 220 220" width="220" height="220">
        {paths.map((p) => (
          p.isFullCircle ? (
            <circle key={p.label} cx="110" cy="110" r="100" fill={p.color} stroke="#fff" strokeWidth="2" />
          ) : (
            <path key={p.label} d={p.path} fill={p.color} stroke="#fff" strokeWidth="2" />
          )
        ))}
      </svg>
      <div className="staff-pie-legend">
        {paths.map((p) => (
          <div key={p.label} className="staff-pie-legend-row">
            <span className="staff-pie-legend-dot" style={{ backgroundColor: p.color }} />
            <span>{p.label}</span>
            <span className="staff-pie-legend-value">
              {p.value} ({p.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InteractivePieChart({ pieChart }) {
  const [view, setView] = useState('total'); // total | pending | completed

  if (!pieChart) return <ListLoader />;

  let slices;
  if (view === 'total') {
    slices = [
      { label: 'Pending', value: pieChart.total.pending, color: PIE_COLORS.pending },
      { label: 'Completed', value: pieChart.total.completed, color: PIE_COLORS.completed },
    ];
  } else if (view === 'pending') {
    slices = pieChart.pending_by_module.map((m, i) => ({
      label: m.module,
      value: m.pending,
      color: MODULE_PALETTE[i % MODULE_PALETTE.length],
    }));
  } else {
    slices = pieChart.completed_by_module.map((m, i) => ({
      label: m.module,
      value: m.completed,
      color: MODULE_PALETTE[i % MODULE_PALETTE.length],
    }));
  }

  return (
    <>
      <div className="staff-pie-toggle-row">
        <button
          type="button"
          className={`staff-pie-toggle ${view === 'total' ? 'active' : ''}`}
          onClick={() => setView('total')}
        >
          Total
        </button>
        <button
          type="button"
          className={`staff-pie-toggle ${view === 'pending' ? 'active' : ''}`}
          onClick={() => setView('pending')}
        >
          Pending
        </button>
        <button
          type="button"
          className={`staff-pie-toggle ${view === 'completed' ? 'active' : ''}`}
          onClick={() => setView('completed')}
        >
          Complete
        </button>
      </div>
      <PieChart slices={slices} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                          SPECIAL PERMISSION-BASED ALERTS                   */
/* -------------------------------------------------------------------------- */

// `alerts` is null when the staff member doesn't have that module's
// permission (backend returns null for it) — the whole box stays hidden in
// that case instead of showing an empty list. It's undefined while the
// /staff/dashboard/alerts request is still in flight, which falls through
// to the loading spinner.

function KsebRegistrationAlertBox({ alerts }) {
  if (alerts === null) return null;

  return (
    <ChartCard title="KSEB Registration Due">
      {!alerts ? (
        <ListLoader />
      ) : alerts.length === 0 ? (
        <EmptyState message="No pending KSEB registrations right now." />
      ) : (
        <div className="staff-alert-list">
          {alerts.map((a) => (
            <div key={a.customer_id} className={`staff-alert-row ${a.is_overdue ? 'is-overdue' : ''}`}>
              <div className="staff-alert-row-top">
                <span className="staff-alert-customer">{a.customer_name}</span>
                {a.is_overdue && (
                  <span className="staff-alert-badge">
                    <AlertTriangle size={14} /> Overdue
                  </span>
                )}
              </div>
              <div className="staff-alert-row-bottom">
                <span>Feasibility: {a.feasibility_date}</span>
                <span>Deadline: {a.deadline_date}</span>
                <span>{a.is_overdue ? `${Math.abs(a.days_left)} days overdue` : `${a.days_left} days left`}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function ServiceDueAlertBox({ alerts }) {
  if (alerts === null) return null;

  return (
    <ChartCard title="Service Due Date">
      {!alerts ? (
        <ListLoader />
      ) : alerts.length === 0 ? (
        <EmptyState message="No upcoming service due dates right now." />
      ) : (
        <div className="staff-alert-list">
          {alerts.map((a) => (
            <div key={a.customer_id} className={`staff-alert-row ${a.is_overdue ? 'is-overdue' : ''}`}>
              <div className="staff-alert-row-top">
                <span className="staff-alert-customer">{a.customer_name}</span>
                {a.is_overdue && (
                  <span className="staff-alert-badge">
                    <AlertTriangle size={14} /> Overdue
                  </span>
                )}
              </div>
              <div className="staff-alert-row-bottom">
                <span>Due: {a.due_date}</span>
                <span>{a.is_overdue ? `${Math.abs(a.days_left)} days overdue` : `${a.days_left} days left`}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/* -------------------------------------------------------------------------- */
/*                         RECENTLY UPDATED PROJECTS                          */
/* -------------------------------------------------------------------------- */

function RecentActivitiesList({ activities, navigateTo }) {
  if (!activities) return <ListLoader />;
  if (activities.activities.length === 0) {
    return <EmptyState message="No recent activity for your modules yet." />;
  }

  return (
    <div className="staff-activity-list">
      {activities.activities.map((a) => (
        <button
          key={a.id}
          type="button"
          className="staff-activity-item staff-activity-item-clickable"
          onClick={() => navigateTo && navigateTo(`/customers/${a.customer_id}`)}
        >
          <div className="staff-activity-item-top">
            <span className="staff-activity-module">{a.module}</span>
            <span className="staff-activity-time">
              {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
            </span>
          </div>
          <p>
            <strong>{a.performed_by || 'System'}</strong> {a.action?.toLowerCase()} {a.customer_name ? `— ${a.customer_name}` : ''}
          </p>
          {a.description && <p className="staff-activity-description">{a.description}</p>}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              STAFF DASHBOARD                               */
/* -------------------------------------------------------------------------- */

function StaffDashboard({ user, role, onLogout, currentPath, navigateTo, children }) {
  const [error, setError] = useState(null);

  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [activities, setActivities] = useState(null);

  useEffect(() => {
    if (currentPath !== '/') return;
    Promise.all([
      staffDashboardApi.summary().then(setSummary),
      staffDashboardApi.alerts().then(setAlerts),
      staffDashboardApi.recentActivities().then(setActivities),
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
            <h2>Staff Dashboard</h2>
            <p className="welcome-back-text">Welcome back, {user?.full_name || 'Staff'}</p>
          </header>
          {error && <div className="table-error-fallback">Failed to load dashboard data: {error}</div>}

          <SummaryCards summary={summary} />

          <div className="dashboard-split-layout">
            <div className="dashboard-split-main">
              <ChartCard title="Work Overview">
                <InteractivePieChart pieChart={summary?.pie_chart} />
              </ChartCard>

              <KsebRegistrationAlertBox alerts={alerts ? alerts.kseb_registration_alerts : undefined} />
              <ServiceDueAlertBox alerts={alerts ? alerts.service_due_alerts : undefined} />
            </div>

            <div className="dashboard-split-side">
              <ChartCard title="Recently Updated Projects">
                <RecentActivitiesList activities={activities} navigateTo={navigateTo} />
              </ChartCard>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </Layout>
  );
}

export default StaffDashboard;