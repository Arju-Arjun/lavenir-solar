const BASE_URL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : "/api";

async function request(path) {
  const token = localStorage.getItem("token");

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    let errorMessage = `Request failed (${res.status})`;

    try {
      const error = await res.json();
      errorMessage = error.message || errorMessage;
    } catch (_) {}

    throw new Error(errorMessage);
  }

  return res.json();
}

/* -------------------------------------------------------------------------- */
/*                                  ADMIN API                                 */
/* -------------------------------------------------------------------------- */

export const adminDashboardApi = {
  newCustomersPerMonth: (year) =>
    request(
      `/admin/dashboard/new-customers-per-month${
        year ? `?year=${year}` : ""
      }`
    ),

  yearlySummary: () =>
    request("/admin/dashboard/yearly-summary"),

  totalCapacity: () =>
    request("/admin/dashboard/total-capacity"),

  pendingSummary: () =>
    request("/admin/dashboard/pending-summary"),

  projectStatus: () =>
    request("/admin/dashboard/project-status"),

  districtDistribution: () =>
    request("/admin/dashboard/district-distribution"),

  alerts: () =>
    request("/admin/dashboard/alerts"),

  userInfo: () =>
    request("/admin/dashboard/user-info"),
};


/* -------------------------------------------------------------------------- */
/*                                  STAFF API                                 */
/* -------------------------------------------------------------------------- */

export const staffDashboardApi = {

  // Top Summary Cards (Total Assigned Modules / Total Pending / Total
  // Complete) + the pie-chart data for the Total/Pending/Complete click states
  summary: () =>
    request("/staff/dashboard/summary"),

  // Permission-gated special alerts: KSEB Registration due list and
  // Service Due Date list. Either key comes back null if the staff member
  // doesn't have that module's permission.
  alerts: () =>
    request("/staff/dashboard/alerts"),

  // Recently Updated Projects (defaults to latest 4; pass a number to
  // override, e.g. recentActivities(10))
  recentActivities: (limit) =>
    request(
      `/staff/dashboard/recent-activities${limit ? `?limit=${limit}` : ""}`
    ),
};