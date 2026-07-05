/**
 * Map app routes to usage tool ids (stored in BigQuery user_usage_events.tool).
 * @param {string} pathname
 */
export function toolFromPathname(pathname) {
  const p = String(pathname || '').split('?')[0]
  if (p === '/' || p === '/dashboard') return 'inventory'
  if (p === '/analytics') return 'analytics'
  if (p === '/data-management') return 'data_management'
  if (p === '/user-tasks') return 'user_tasks'
  if (p === '/admin/access') return 'admin_access'
  if (p === '/admin/usage') return 'admin_usage'
  return null
}

/** @param {string} tool */
export function labelForUsageTool(tool) {
  const labels = {
    inventory: 'Inventory (map)',
    analytics: 'Analytics',
    data_management: 'Data Management',
    user_tasks: 'User Tasks',
    admin_access: 'Admin Access',
    admin_usage: 'Usage Dashboard',
  }
  return labels[tool] || tool
}
