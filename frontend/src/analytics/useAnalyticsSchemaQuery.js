import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'

/**
 * Phase B: optional GET metadata for analytics fields (BigQuery-backed catalog).
 */
export function useAnalyticsSchemaQuery() {
  const { user, loading: authLoading } = useAuth()
  return useQuery({
    queryKey: ['analytics', 'schema', mapApiEnv.analyticsSchemaUrl, user?.uid ?? ''],
    enabled: Boolean(!authLoading && user && mapApiEnv.analyticsSchemaUrl),
    staleTime: 3600_000,
    queryFn: async () => {
      const token = await user.getIdToken()
      const res = await fetch(mapApiEnv.analyticsSchemaUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Schema request failed (${res.status})`)
      return json
    },
  })
}
