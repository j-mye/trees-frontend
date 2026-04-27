import { mapApiEnv } from '../config/mapApiEnv.js'

/**
 * @param {{ token: string, draft: object }} args
 * @returns {Promise<{ rows: Array<Record<string, unknown>>; columns?: string[]; source?: string }>}
 */
export async function fetchAnalyticsQueryRemote({ token, draft }) {
  const url = mapApiEnv.analyticsQueryUrl
  if (!url) throw new Error('Analytics query URL is not configured')
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ draft }),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Analytics query: expected JSON (${res.status})`)
  }
  if (!res.ok) {
    throw new Error(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`)
  }
  if (!Array.isArray(json?.rows)) {
    throw new Error('Analytics query: response missing rows array')
  }
  return json
}
