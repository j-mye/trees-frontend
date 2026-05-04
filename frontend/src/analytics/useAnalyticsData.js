import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'
import { executeClientAnalyticsQuery } from './clientAggregate.js'
import { serializeDraftQuery } from './draftSerialize.js'
import { sanitizeChartRowsForDisplay } from './sanitizeChart.js'
import { fetchAnalyticsQueryRemote } from './remoteAnalytics.js'
import { downsampleChartRows } from './chartSample.js'

/** Max points passed to Recharts (memory + paint). */
const CHART_MAX_POINTS = 3500

/**
 * @param {{ properties?: object }[]} rows
 */
function rowsToChartShape(rows) {
  /** @type {Array<{ xLabel: string, yValue: number, series?: string }>} */
  const out = []
  for (const r of rows) {
    if (r && typeof r === 'object' && 'xLabel' in r && 'yValue' in r) {
      out.push({
        xLabel: String(r.xLabel),
        yValue: Number(r.yValue) || 0,
        ...(r.series != null ? { series: String(r.series) } : {}),
      })
    }
  }
  return out
}

/**
 * Quarter-section GeoJSON features from the same summaries API as the map.
 */
export function useSummariesFeaturesQuery() {
  const { user, loading: authLoading } = useAuth()
  return useQuery({
    queryKey: ['analytics', 'qs-summaries-features', user?.uid ?? '', mapApiEnv.summariesUrl],
    enabled: Boolean(!authLoading && user && mapApiEnv.summariesUrl),
    staleTime: 60_000,
    queryFn: async () => {
      const token = await user.getIdToken()
      const res = await fetch(mapApiEnv.summariesUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
      return Array.isArray(json?.geojson?.features) ? json.geojson.features : []
    },
  })
}

/**
 * @param {{
 *   getDraft: () => {
 *     xAxisItem: import('./types.js').Variable | null
 *     yAxisItem: import('./types.js').Variable | null
 *     yAggregation: import('./types.js').Aggregation
 *     colorItem: import('./types.js').Variable | null
 *     draftFilters: import('./types.js').DraftFilter[]
 *     chartType: import('./types.js').ChartType
 *   }
 * }} opts
 */
export function useRunAnalyticsMutation(opts) {
  const { user } = useAuth()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (/** @type {{ features: { properties?: object }[] }} */ payload) => {
      const draft = opts.getDraft()
      const { xAxisItem, yAxisItem, yAggregation, colorItem, draftFilters, chartType } = draft
      const remoteEnabled = Boolean(mapApiEnv.analyticsQueryUrl && user)
      console.info('[analytics] run start', {
        mode: remoteEnabled ? 'remote' : 'client',
        analyticsQueryUrl: mapApiEnv.analyticsQueryUrl || null,
        summariesUrl: mapApiEnv.summariesUrl || null,
        featuresCount: Array.isArray(payload.features) ? payload.features.length : 0,
        xAxisItem: xAxisItem?.id ?? null,
        yAxisItem: yAxisItem?.id ?? null,
        yAggregation,
        colorItem: colorItem?.id ?? null,
        draftFilters,
        chartType,
      })
      if (!xAxisItem || !yAxisItem || !yAggregation) {
        throw new Error('Incomplete draft')
      }
      const cacheKey = [
        'analytics',
        'tabular',
        serializeDraftQuery({ xAxisItem, yAxisItem, yAggregation, colorItem, draftFilters, chartType }),
      ]

      return qc.fetchQuery({
        queryKey: cacheKey,
        staleTime: 5 * 60_000,
        queryFn: async () => {
          if (mapApiEnv.analyticsQueryUrl && user) {
            const token = await user.getIdToken()
            const remote = await fetchAnalyticsQueryRemote({
              token,
              draft: { xAxisItem, yAxisItem, yAggregation, colorItem, draftFilters, chartType },
            })
            const shaped = sanitizeChartRowsForDisplay(rowsToChartShape(remote.rows))
            const { rows: chartRows, sampled, originalCount } = downsampleChartRows(shaped, CHART_MAX_POINTS)
            console.info('[analytics] run success', {
              mode: 'remote',
              responseSource: remote.source ?? 'remote',
              rowsRaw: Array.isArray(remote.rows) ? remote.rows.length : 0,
              rowsShaped: shaped.length,
              chartPoints: chartRows.length,
              chartSampled: sampled,
            })
            return {
              rows: chartRows,
              source: remote.source ?? 'remote',
              meta: {
                rowsReturned: shaped.length,
                chartMaxPoints: CHART_MAX_POINTS,
                chartSampled: sampled,
                chartOriginalCount: originalCount,
              },
            }
          }
          const rows = executeClientAnalyticsQuery({
            features: payload.features,
            xAxisItem,
            yAxisItem,
            yAggregation,
            colorItem,
            draftFilters,
          })
          const {
            rows: chartRowsClient,
            sampled: sampledClient,
            originalCount: originalCountClient,
          } = downsampleChartRows(rows, CHART_MAX_POINTS)
          console.info('[analytics] run success', {
            mode: 'client',
            rowsCount: rows.length,
            chartPoints: chartRowsClient.length,
            chartSampled: sampledClient,
            preview: chartRowsClient.slice(0, 5),
          })
          return {
            rows: chartRowsClient,
            source: 'client',
            meta: {
              rowsReturned: rows.length,
              chartMaxPoints: CHART_MAX_POINTS,
              chartSampled: sampledClient,
              chartOriginalCount: originalCountClient,
            },
          }
        },
      })
    },
  })
}
