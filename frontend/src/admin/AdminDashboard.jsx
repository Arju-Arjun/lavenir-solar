import React, { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, Zap, ChevronDown, Loader2, LayoutGrid, BarChart3, AlertTriangle,
} from 'lucide-react';
import { adminDashboardApi } from '../utils/dashboardApi';

const PIE_COLORS = { completed: '#10b981', pending: '#ef4444' };

// Every selectable line on the growth chart, in the order the tick-list
// legend renders them. `axis` decides which Y-axis (customer counts vs kW)
// it plots against — the two scales are far apart, so mixing them on one
// axis would flatten whichever is smaller.
const LINE_DEFS = [
  { key: 'new_customers', label: 'New Customers', color: '#10b981', axis: 'left' },
  { key: 'cumulative_customers', label: 'Total Customers', color: '#ef4444', axis: 'left' },
  { key: 'new_capacity_kw', label: 'Capacity (per month)', color: '#3b82f6', axis: 'right' },
  { key: 'cumulative_capacity_kw', label: 'Total Capacity', color: '#8b5cf6', axis: 'right' },
];

// Only "New Customers" is on by default; everything else switches on via
// the tick list below the chart.
const DEFAULT_VISIBLE_LINES = {
  new_customers: true,
  cumulative_customers: false,
  new_capacity_kw: false,
  cumulative_capacity_kw: false,
};

function MetricCard({ icon: Icon, accentClass, label, value, sub, onClick }) {
  return (
    <div
      className={`metric-card${onClick ? ' metric-card-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className={`metric-card-icon ${accentClass}`}>
        <Icon size={22} />
      </div>
      <div className="metric-card-body">
        <h3>{label}</h3>
        <div className="metric-value">{value}</div>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

function PendingMetricCard({ data }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="metric-card pending-metric-card">
      <button className="pending-card-toggle" onClick={() => setOpen((o) => !o)}>
        <div className="metric-card-icon accent-amber">
          <ChevronDown size={22} className={`pending-chevron ${open ? 'pending-chevron-open' : ''}`} />
        </div>
        <div className="metric-card-body">
          <h3>Pending Modules</h3>
          <div className="metric-value">{data ? data.total_pending : '--'}</div>
          <p>Click to see breakdown by module</p>
        </div>
      </button>

      {open && data && (
        <div className="pending-breakdown-list">
          {data.breakdown.map((row) => (
                
            <div key={row.module} className="pending-breakdown-row">
              {row.module !== 'Service' &&(
                <>
                  <span>{row.module}</span>
                  <span className="pending-breakdown-count">{row.pending_count}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, height = 300, headerRight, children, cardStyle, bodyStyle, titleStyle }) {
  return (
    <div className="chart-card" style={cardStyle}>
      <div className="chart-card-header">
        <h3 className="chart-card-title" style={titleStyle}>{title}</h3>
        {headerRight}
      </div>
      <div className="chart-card-body" style={{ height, ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

function ChartLoader() {
  return (
    <div className="chart-loading-state">
      <Loader2 className="spin-icon" size={22} />
    </div>
  );
}

function ListLoader() {
  return (
    <div className="chart-loading-state" style={{ minHeight: 120 }}>
      <Loader2 className="spin-icon" size={20} />
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div
      style={{
        border: '1px dashed #cbd5e1',
        borderRadius: '10px',
        padding: '12px 14px',
        background: '#fff',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>{message}</p>
    </div>
  );
}

function KsebRegistrationAlertList({ alerts, navigateTo }) {
  if (alerts === null) return null;
  if (!alerts) return <ListLoader />;
  if (alerts.length === 0) return <EmptyState message="No pending KSEB registrations right now." />;

  return (
    <div id="kseb-registration-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {alerts.map((alert) => (
        <div
          key={alert.customer_id}
          onClick={() => navigateTo(`/customer-profile/${alert.customer_id}?tab=completion`)}
          role="button"
          tabIndex={0}
          style={{
            border: `1px solid ${alert.is_overdue ? '#fecaca' : '#e2e8f0'}`,
            borderLeft: `3px solid ${alert.is_overdue ? '#ef4444' : '#3b82f6'}`,
            borderRadius: '10px',
            padding: '10px 12px',
            background: alert.is_overdue ? '#fef2f2' : '#f8fafc',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>{alert.customer_name}</span>
            {alert.is_overdue && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#fee2e2', color: '#dc2626', fontSize: '0.68rem', fontWeight: 700 }}>
                <AlertTriangle size={14} /> Overdue
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: '0.74rem', color: '#64748b' }}>
            <span>Feasibility: {alert.feasibility_date}</span>
            <span>Deadline: {alert.deadline_date}</span>
            <span>{alert.is_overdue ? `${Math.abs(alert.days_left)} days overdue` : `${alert.days_left} days left`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ServiceDueAlertList({ alerts, navigateTo }) {
  if (alerts === null) return null;
  if (!alerts) return <ListLoader />;
  if (alerts.length === 0) return <EmptyState message="No upcoming service due dates right now." />;

  return (
    <div id="service-due-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {alerts.map((alert) => (
        <div
          key={alert.customer_id}
          onClick={() => navigateTo(`/customer-profile/${alert.customer_id}?tab=service`)}
          role="button"
          tabIndex={0}
          style={{
            border: `1px solid ${alert.is_overdue ? '#fecaca' : '#e2e8f0'}`,
            borderLeft: `3px solid ${alert.is_overdue ? '#ef4444' : '#3b82f6'}`,
            borderRadius: '10px',
            padding: '10px 12px',
            background: alert.is_overdue ? '#fef2f2' : '#f8fafc',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>{alert.customer_name}</span>
            {alert.is_overdue && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#fee2e2', color: '#dc2626', fontSize: '0.68rem', fontWeight: 700 }}>
                <AlertTriangle size={14} /> Overdue
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: '0.74rem', color: '#64748b' }}>
            <span>Service # {alert.maintenance_service_count + 1}</span>
            <span>Due: {alert.due_date}</span>
            <span>{alert.is_overdue ? `${Math.abs(alert.days_left)} days overdue` : `${alert.days_left} days left`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Month vs Year(Total) selector — a plain <select> using the app's existing
 * .control-select-dropdown look, rather than pill/toggle buttons.
 */
function GrowthModeSelect({ mode, onChange }) {
  return (
    <select
      className="control-select-dropdown growth-mode-select"
      value={mode}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="monthly">Month</option>
      <option value="yearly">Year (Total)</option>
    </select>
  );
}

/**
 * Year select, only shown in Month mode. Options start at 2025 and run
 * through the current year, driven by `available_years` from the API so
 * the frontend never has to guess the current year itself.
 */
function YearSelect({ years, value, onChange }) {
  if (!years || years.length === 0) return null;
  return (
    <select
      className="control-select-dropdown growth-year-select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
}

/**
 * Custom tick-list legend, shown below the chart. Each line has its own
 * checkbox; ticking it is the only thing that adds/removes that line from
 * the chart — independent of the others, so any combination can be shown
 * at once. Replaces recharts' built-in <Legend/> entirely.
 */
function GrowthLegendList({ visibleLines, onToggle }) {
  return (
    <div className="growth-legend-list">
      {LINE_DEFS.map((def) => (
        <label key={def.key} className="growth-legend-item">
          <input
            type="checkbox"
            className="growth-legend-checkbox"
            checked={!!visibleLines[def.key]}
            onChange={() => onToggle(def.key)}
            style={{ accentColor: def.color }}
          />
          <span className="growth-legend-dot" style={{ backgroundColor: def.color }} />
          <span className="growth-legend-label">{def.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * The growth chart. One component drives both Month (line chart, x-axis =
 * month) and Year/Total (bar chart, x-axis = year) — whichever lines are
 * ticked in visibleLines get rendered, each against the axis it belongs to.
 * An axis only renders if a visible line actually uses it.
 */
function GrowthChart({ mode, data, visibleLines }) {
  if (!data) return <ChartLoader />;

  const xKey = mode === 'monthly' ? 'month' : 'year';
  const needsLeftAxis = visibleLines.new_customers || visibleLines.cumulative_customers;
  const needsRightAxis = visibleLines.new_capacity_kw || visibleLines.cumulative_capacity_kw;
  const anyVisible = needsLeftAxis || needsRightAxis;
  const ChartComponent = mode === 'monthly' ? LineChart : BarChart;

  return (
    <div className="growth-chart-wrapper">
      <ResponsiveContainer>
        <ChartComponent data={data.series} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} stroke="#94a3b8" />
          {needsLeftAxis && (
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} allowDecimals={false} stroke="#94a3b8" />
          )}
          {needsRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
              label={{ value: 'kW', angle: 90, position: 'insideRight', fontSize: 11, fill: '#94a3b8' }}
            />
          )}
          <Tooltip />
          {LINE_DEFS.map((def) => {
            if (!visibleLines[def.key]) return null;
            return mode === 'monthly' ? (
              <Line
                key={def.key}
                yAxisId={def.axis}
                type="monotone"
                dataKey={def.key}
                name={def.label}
                stroke={def.color}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            ) : (
              <Bar
                key={def.key}
                yAxisId={def.axis}
                dataKey={def.key}
                name={def.label}
                fill={def.color}
                radius={[4, 4, 0, 0]}
              />
            );
          })}
        </ChartComponent>
      </ResponsiveContainer>
      {!anyVisible && (
        <div className="growth-chart-empty-overlay">Tick a line below to display it</div>
      )}
    </div>
  );
}

function AdminOverviewTab({
  capacity, pending, alerts,
  monthlyTrend, yearlySummary,
  mode, onModeChange,
  selectedYear, onYearChange,
  visibleLines, onToggleLine,
  navigateTo,
}) {
  const activeData = mode === 'monthly' ? monthlyTrend : yearlySummary;

  // Once loaded, an empty array means there's genuinely nothing to show —
  // hide that card entirely rather than showing an "empty" message.
  // While alerts is still loading (undefined/null), leave it visible so the
  // list's own loading state (ListLoader) still renders.
  const ksebAlerts = alerts?.kseb_registration_alerts;
  const serviceAlerts = alerts?.service_due_alerts;
  const ksebIsEmpty = Array.isArray(ksebAlerts) && ksebAlerts.length === 0;
  const serviceIsEmpty = Array.isArray(serviceAlerts) && serviceAlerts.length === 0;
  const showKsebCard = !ksebIsEmpty;
  const showServiceCard = !serviceIsEmpty;
  const showAlertsGrid = showKsebCard || showServiceCard;

  return (
    <>
      <div className="analytics-metrics-grid">
        <MetricCard
          icon={Users}
          accentClass="accent-slate"
          label="Total Customers"
          value={yearlySummary ? yearlySummary.total_customers : '--'}
          onClick={() => navigateTo('/customers')}
        />
        <MetricCard
          icon={Zap}
          accentClass="accent-gold"
          label="Total System Capacity Installed"
          value={capacity ? `${capacity.total_capacity_kw.toLocaleString()} kW` : '--'}
          sub={capacity ? `${capacity.project_count} projects · avg ${capacity.average_capacity_kw} kW` : undefined}
        />
        <PendingMetricCard data={pending} />
      </div>

      <ChartCard
        title={mode === 'monthly' ? `Customer & Capacity Growth — ${selectedYear}` : 'Customer & Capacity Growth — Yearly Totals'}
        height={400}
        headerRight={
          <div className="chart-card-controls">
            {mode === 'monthly' && (
              <YearSelect
                years={monthlyTrend?.available_years}
                value={selectedYear}
                onChange={onYearChange}
              />
            )}
            <GrowthModeSelect mode={mode} onChange={onModeChange} />
          </div>
        }
      >
        <GrowthChart mode={mode} data={activeData} visibleLines={visibleLines} />
        <GrowthLegendList visibleLines={visibleLines} onToggle={onToggleLine} />
      </ChartCard>

      {showAlertsGrid && (
        <div className="chart-card-grid">
          {showKsebCard && (
            <ChartCard
              title="KSEB Registration Due"
              height="auto"
              cardStyle={{ padding: '14px 16px', marginBottom: 0 }}
              titleStyle={{ marginBottom: 10 }}
            >
              <KsebRegistrationAlertList alerts={ksebAlerts} navigateTo={navigateTo} />
            </ChartCard>
          )}
          {showServiceCard && (
            <ChartCard
              title="Service Due Date"
              height="auto"
              cardStyle={{ padding: '14px 16px', marginBottom: 0 }}
              titleStyle={{ marginBottom: 10 }}
            >
              <ServiceDueAlertList alerts={serviceAlerts} navigateTo={navigateTo} />
            </ChartCard>
          )}
        </div>
      )}
    </>
  );
}

function AdminAnalyticsTab({ status, districts }) {
  const statusPieData = status
    ? [
        { name: 'Completed', value: status.completed },
        { name: 'Pending', value: status.pending },
      ]
    : [];

  return (
    <div className="chart-card-grid">
      <ChartCard title="Project Status (Work Completed vs Pending)">
        {status ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={statusPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, value }) => `${name}: ${value}`}
              >
                <Cell fill={PIE_COLORS.completed} />
                <Cell fill={PIE_COLORS.pending} />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : <ChartLoader />}
      </ChartCard>

      <ChartCard title="District-wise Customer Distribution">
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
      </ChartCard>
    </div>
  );
}

function AdminDashboard({ user, role, onLogout, currentPath, navigateTo, children }) {
  const [tab, setTab] = useState('overview');
  const [capacity, setCapacity] = useState(null);
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState(null);
  const [districts, setDistricts] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState(null);

  // Growth chart state: Month vs Year(Total) mode, which year is selected
  // (Month mode only), and the data for each — fetched independently so
  // switching mode/year doesn't re-fetch everything else on the page.
  const [growthMode, setGrowthMode] = useState('monthly');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [monthlyTrend, setMonthlyTrend] = useState(null);
  const [yearlySummary, setYearlySummary] = useState(null);

  // Which lines are ticked on in the legend below the chart. Shared across
  // Month/Year modes since both series expose the same four keys.
  const [visibleLines, setVisibleLines] = useState(DEFAULT_VISIBLE_LINES);
  const toggleLine = (key) => {
    setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const loadMonthlyTrend = useCallback((year) => {
    adminDashboardApi.newCustomersPerMonth(year)
      .then((data) => {
        // Normalize the monthly payload's `cumulative_total` to
        // `cumulative_customers` so both Month and Year series share the
        // same field names — lets the chart/legend logic stay identical
        // for both modes.
        const normalized = {
          ...data,
          series: data.series.map((row) => ({
            ...row,
            cumulative_customers: row.cumulative_total,
          })),
        };
        setMonthlyTrend(normalized);
        // Snap the selector to whatever year the API actually returned
        // (it clamps out-of-range years server-side too).
        setSelectedYear(data.year);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (currentPath !== '/') return;
    Promise.all([
      adminDashboardApi.totalCapacity().then(setCapacity),
      adminDashboardApi.pendingSummary().then(setPending),
      adminDashboardApi.projectStatus().then(setStatus),
      adminDashboardApi.districtDistribution().then(setDistricts),
      adminDashboardApi.alerts().then(setAlerts),
      adminDashboardApi.yearlySummary().then(setYearlySummary),
    ]).catch((e) => setError(e.message));

    loadMonthlyTrend(selectedYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const handleYearChange = (year) => {
    setSelectedYear(year);
    loadMonthlyTrend(year);
  };

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
        {/* <header className="dashboard-view-header"> */}
          <div className="profile-header-summary-card"><h2> Admin Dashboard</h2></div>
          <p className="welcome-back-text">Welcome back, {user?.full_name || 'Admin'}</p>
        {/* </header> */}
          {error && <div className="table-error-fallback">Failed to load dashboard data: {error}</div>}

          <div className="dashboard-tabs">
            <button
              className={`dashboard-tab-btn ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              <LayoutGrid size={16} /> Overview
            </button>
            <button
              className={`dashboard-tab-btn ${tab === 'analytics' ? 'active' : ''}`}
              onClick={() => setTab('analytics')}
            >
              <BarChart3 size={16} /> Analytics
            </button>
          </div>

          {tab === 'overview' ? (
            <AdminOverviewTab
              capacity={capacity}
              pending={pending}
              alerts={alerts}
              monthlyTrend={monthlyTrend}
              yearlySummary={yearlySummary}
              mode={growthMode}
              onModeChange={setGrowthMode}
              selectedYear={selectedYear}
              onYearChange={handleYearChange}
              visibleLines={visibleLines}
              onToggleLine={toggleLine}
              navigateTo={navigateTo}
            />
          ) : (
            <AdminAnalyticsTab status={status} districts={districts} />
          )}
        </div>
      ) : (
        children
      )}
    </Layout>
  );
}

export default AdminDashboard;