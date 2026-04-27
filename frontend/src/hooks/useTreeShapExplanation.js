import { useQuery } from '@tanstack/react-query'
import { getFirebaseAuth } from '../firebase.js'

/**
 * Fetch SHAP English explanation for a tree/site id from getTreeShapExplanation.
 *
 * @param {object} options
 * @param {string | null | undefined} options.siteId Tree key (e.g. tree_row_id); query disabled when falsy.
 * @param {string} options.shapExplanationUrl Full Cloud Function URL (VITE_CF_GET_TREE_SHAP_EXPLANATION_URL).
 * @returns {import('@tanstack/react-query').UseQueryResult<string | null, Error>}
 */
export function useTreeShapExplanation({ siteId, shapExplanationUrl }) {
  const url = String(shapExplanationUrl || '').trim()
  const id = siteId != null && String(siteId).trim() !== '' ? String(siteId).trim() : null

  return useQuery({
    queryKey: ['treeShapExplanation', url, id],
    enabled: Boolean(url && id),
    queryFn: async () => {
      const auth = getFirebaseAuth()
      const user = auth?.currentUser
      if (!user) {
        throw new Error('Sign in required')
      }
      const token = await user.getIdToken()
      const sep = url.includes('?') ? '&' : '?'
      const res = await fetch(`${url}${sep}site_id=${encodeURIComponent(id)}`, {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`Expected JSON; got HTTP ${res.status}: ${text.slice(0, 220)}`)
      }
      if (!res.ok) {
        const msg = typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`
        throw new Error(msg)
      }
      const raw = json?.english_translation
      if (raw == null) return null
      const s = String(raw).trim()
      return s.length ? s : null
    },
  })
}
