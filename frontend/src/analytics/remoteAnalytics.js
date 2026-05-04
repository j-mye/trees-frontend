import { mapApiEnv } from '../config/mapApiEnv.js'

/**
 * @param {{ token: string, draft: object }} args
 * @returns {Promise<{ rows: Array<Record<string, unknown>>; columns?: string[]; source?: string }>}
 */
export async function fetchAnalyticsQueryRemote({ token, draft }) {
  const url = mapApiEnv.analyticsQueryUrl
  if (!url) throw new Error('Analytics query URL is not configured')
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ draft }),
    })
  } catch (err) {
    console.warn(
      '[analytics] analytics_query fetch failed (network/CORS). If status was 503 in Network, check GCP logs — infra errors often omit CORS headers so the browser blames CORS.',
      { url, message: err instanceof Error ? err.message : String(err) },
    )
    throw err
  }
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    console.warn('[analytics] analytics_query non-JSON body', {
      status: res.status,
      preview: text.slice(0, 400),
    })
    throw new Error(`Analytics query: expected JSON (${res.status})`)
  }
  if (!res.ok) {
    console.warn('[analytics] analytics_query HTTP error', {
      status: res.status,
      statusText: res.statusText,
      body: json ?? text.slice(0, 400),
    })
    throw new Error(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`)
  }
  if (!Array.isArray(json?.rows)) {
    throw new Error('Analytics query: response missing rows array')
  }
  return {
    rows: json.rows,
    columns: json.columns,
    source: json.source,
  }
}
