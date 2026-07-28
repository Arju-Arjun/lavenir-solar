// dashboardApi.js
// Thin fetch wrapper for the dashboard endpoints.
// Sends the JWT issued at login as a Bearer token (matches flask_jwt_extended
// on the backend, which reads Authorization: Bearer <token> by default).

const BASE_URL = "/api";

async function request(path) {
  const token = localStorage.getItem("token"); // <-- adjust key to match your login code

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
    },
  });

  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json();
}

export const adminDashboardApi = {
  newCustomersPerMonth: (year) =>
    request(`/admin/dashboard/new-customers-per-month${year ? `?year=${year}` : ""}`),
  yearlySummary: () => request("/admin/dashboard/yearly-summary"),
  totalCapacity: () => request("/admin/dashboard/total-capacity"),
  pendingSummary: () => request("/admin/dashboard/pending-summary"),
  projectStatus: () => request("/admin/dashboard/project-status"),
  districtDistribution: () => request("/admin/dashboard/district-distribution"),
  upcomingServices: () => request("/admin/dashboard/upcoming-services"),
  userInfo: () => request("/admin/dashboard/user-info"),
};

export const staffDashboardApi = {
  pendingTasks: () => request("/staff/dashboard/pending-tasks"),
  districtDistribution: () => request("/staff/dashboard/district-distribution"),
  completedThisMonth: () => request("/staff/dashboard/completed-this-month"),
  myPermissionRequests: () => request("/staff/dashboard/my-permission-requests"),
};