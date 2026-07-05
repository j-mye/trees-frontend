import { mapApiEnv } from '../config/mapApiEnv.js'

async function accessRequest({ user, method = 'GET', query = '', body = null }) {
  const base = mapApiEnv.accessApiUrl.replace(/\/$/, '')
  if (!base) {
    throw new Error('Access API is not configured (VITE_CF_ACCESS_API_URL)')
  }
  const token = await user.getIdToken()
  const qs = query ? `?${query}` : ''
  const res = await fetch(`${base}${qs}`, {
    method,
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Expected JSON (${res.status})`)
  }
  if (!res.ok) {
    const detail = json?.message || json?.error || json?.detail
    const err = new Error(detail ? String(detail) : `Request failed (${res.status})`)
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

export function isAccessApiConfigured() {
  return Boolean(mapApiEnv.accessApiUrl?.trim())
}

export async function fetchAccessMe(user) {
  return accessRequest({ user, method: 'GET', query: 'mode=me' })
}

export async function registerAccessRequest(user, payload) {
  return accessRequest({
    user,
    method: 'POST',
    body: { action: 'register', ...payload },
  })
}

export async function fetchPendingUsers(user) {
  return accessRequest({ user, method: 'GET', query: 'mode=pending' })
}

export async function fetchAllAccessUsers(user) {
  return accessRequest({ user, method: 'GET', query: 'mode=all' })
}

export async function approveAccessUser(user, { user_id, role, tier }) {
  return accessRequest({
    user,
    method: 'POST',
    body: { action: 'approve', user_id, role, tier },
  })
}

export async function rejectAccessUser(user, { user_id, rejection_reason }) {
  return accessRequest({
    user,
    method: 'POST',
    body: { action: 'reject', user_id, rejection_reason },
  })
}

export async function updateAccessUser(user, payload) {
  return accessRequest({
    user,
    method: 'POST',
    body: { action: 'update_user', ...payload },
  })
}

/** @param {import('firebase/auth').User} user @param {object[]} events */
export async function logUsageEvents(user, events) {
  return accessRequest({
    user,
    method: 'POST',
    body: { action: 'log_usage', events },
  })
}

/** @param {import('firebase/auth').User} user @param {number} [days=30] */
export async function fetchUsageStats(user, days = 30) {
  return accessRequest({
    user,
    method: 'GET',
    query: `mode=usage_stats&days=${encodeURIComponent(String(days))}`,
  })
}
