import { useQuery } from '@tanstack/react-query'
import { getFirebaseAuth } from '../firebase.js'

/**
 * @param {object} options
 * @param {string} options.priorityHistoryUrl
 * @param {'quarter_section' | 'district'} options.scope
 * @param {string | null | undefined} [options.qsId]
 * @param {string | null | undefined} [options.district]
 * @param {string | null | undefined} [options.fromDate] YYYY-MM-DD
 * @param {string | null | undefined} [options.toDate] YYYY-MM-DD
 */
export function usePriorityHistory({
  priorityHistoryUrl,
  scope,
  qsId,
  district,
  fromDate,
  toDate,
}) {
  const url = String(priorityHistoryUrl || '').trim()
  const qs = qsId != null && String(qsId).trim() !== '' ? String(qsId).trim() : null
  const dist = district != null && String(district).trim() !== '' ? String(district).trim() : null
  const from = fromDate != null && String(fromDate).trim() !== '' ? String(fromDate).trim() : null
  const to = toDate != null && String(toDate).trim() !== '' ? String(toDate).trim() : null
  const scopeNorm = scope === 'district' ? 'district' : 'quarter_section'

  return useQuery({
    queryKey: ['priorityHistory', url, scopeNorm, qs, dist, from, to],
    enabled: Boolean(url),
    staleTime: 60_000,
    queryFn: async () => {
      const auth = getFirebaseAuth()
      const user = auth?.currentUser
      if (!user) {
        throw new Error('Sign in required')
      }
      const token = await user.getIdToken()
      const params = new URLSearchParams({ scope: scopeNorm })
      if (qs) params.set('qs_id', qs)
      if (dist) params.set('district', dist)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const sep = url.includes('?') ? '&' : '?'
      const res = await fetch(`${url}${sep}${params.toString()}`, {
        method: 'GET',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`Expected JSON; got HTTP ${res.status}: ${text.slice(0, 220)}`)
      }
      if (!res.ok) {
        const msg =
          typeof json?.detail === 'string'
            ? json.detail
            : typeof json?.message === 'string'
              ? json.message
              : typeof json?.error === 'string'
                ? json.error
                : `Request failed (${res.status})`
        throw new Error(msg)
      }
      return json
    },
  })
}
