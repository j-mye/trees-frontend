/**
 * Client-side analytics execution (same summaries GeoJSON as the map).
 *
 * @typedef {import('./types.js').Variable} Variable
 * @typedef {import('./types.js').Aggregation} Aggregation
 * @typedef {import('./types.js').DraftFilter} DraftFilter
 */

import { CATALOG_DIMENSIONS, CATALOG_MEASURES } from './fieldCatalog.js'
import { labelForGroupingCell, sanitizeChartRowsForDisplay } from './sanitizeChart.js'

const CATALOG_ALL = [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES]

/* Never build BigQuery SQL in the browser; server compiler only (see database/cloud_functions/analytics_query). */

/**
 * @typedef {object} QuarterSectionFeatureProperties
 * @property {string} [qs_id]
 * @property {string} [district]
 * @property {string} [priority_level]
 * @property {string} [top_species]
 * @property {string | number} [inspection_year]
 * @property {number} [tree_count]
 * @property {number} [total_trees]
 * @property {number} [avg_dbh]
 * @property {number} [Priority_Score_Normalized]
 */

/**
 * @param {Variable} xAxisItem
 * @param {QuarterSectionFeatureProperties} p
 * @param {number} index
 */
export function featureDimensionRawLabel(xAxisItem, p, index) {
  if (xAxisItem.id === 'dim-district') return labelForGroupingCell(p.district)
  if (xAxisItem.id === 'dim-priority-level') return labelForGroupingCell(p.priority_level ?? 'Low')
  if (xAxisItem.id === 'dim-species') return labelForGroupingCell(p.top_species)
  if (xAxisItem.id === 'dim-inspection-year') {
    const raw = p.inspection_year
    if (raw === undefined || raw === null || String(raw).trim() === '') return 'Unknown'
    return String(raw)
  }
  return `Quarter Section ${String(p.qs_id ?? index + 1)}`
}

/**
 * @param {Variable | null} colorItem
 * @param {Record<string, unknown>} p
 */
export function featureSeriesRawLabel(colorItem, p) {
  if (!colorItem) return ''
  const key = geoPropertyKeyForFieldId(colorItem.id)
  const raw = p[key]
  return labelForGroupingCell(raw)
}

/**
 * @param {Variable} yAxisItem
 * @param {Record<string, unknown>} p
 */
function measureSample(yAxisItem, p) {
  if (yAxisItem.id === 'meas-tree-count') return Number(p['tree_count'] ?? p['total_trees'] ?? 0) || 0
  if (yAxisItem.id === 'meas-avg-dbh') {
    const v = Number(p['avg_dbh'])
    return Number.isFinite(v) ? v : NaN
  }
  const v = Number(p['Priority_Score_Normalized'])
  return Number.isFinite(v) ? v : NaN
}

/**
 * @param {number[]} values
 * @param {Aggregation} agg
 */
function reduceAgg(values, agg) {
  const finite = values.filter((n) => Number.isFinite(n))
  if (agg === 'COUNT') return values.length
  if (!finite.length) return 0
  if (agg === 'SUM') return finite.reduce((a, b) => a + b, 0)
  if (agg === 'AVG') return finite.reduce((a, b) => a + b, 0) / finite.length
  return Math.max(...finite)
}

/**
 * @param {string} fieldId
 */
export function geoPropertyKeyForFieldId(fieldId) {
  const c = CATALOG_ALL.find((x) => x.id === fieldId)
  return c?.bqColumn ?? fieldId
}

/**
 * @param {Record<string, unknown>} p
 * @param {DraftFilter} f
 */
function rowMatchesFilter(p, f) {
  const key = geoPropertyKeyForFieldId(f.fieldId)
  const raw = p[key]
  const cell = Number(raw)
  const num = Number.isFinite(cell) && raw !== '' && raw != null ? cell : NaN
  const str = String(raw ?? '').trim()
  const v = Number(f.value)
  switch (f.op) {
    case 'eq':
      if (!Number.isNaN(num) && Number.isFinite(v) && f.value !== '') return num === v
      return str === String(f.value).trim()
    case 'gt':
      return Number.isFinite(num) && num > v
    case 'gte':
      return Number.isFinite(num) && num >= v
    case 'lt':
      return Number.isFinite(num) && num < v
    case 'lte':
      return Number.isFinite(num) && num <= v
    default:
      return true
  }
}

/**
 * @param {{ properties?: QuarterSectionFeatureProperties }[]} features
 * @param {DraftFilter[]} filters
 */
export function applyDraftFilters(features, filters) {
  if (!filters.length) return features
  return features.filter((feat) => {
    const p = /** @type {Record<string, unknown>} */ (feat?.properties ?? {})
    return filters.every((f) => rowMatchesFilter(p, f))
  })
}

/**
 * @param {Variable} xAxisItem
 * @param {Variable} yAxisItem
 * @param {Aggregation} yAggregation
 * @param {Variable | null} colorItem
 * @param {{ properties?: QuarterSectionFeatureProperties }[]} features
 */
export function buildAggregatedChartRows(xAxisItem, yAxisItem, yAggregation, colorItem, features) {
  if (!Array.isArray(features) || !features.length) return []

  /** @typedef {{ dimLabel: string, seriesLabel: string, samples: number[] }} AggBucket */
  /** @type {Map<string, AggBucket>} */
  const buckets = new Map()

  for (let i = 0; i < features.length; i++) {
    const feature = features[i]
    const p = /** @type {Record<string, unknown>} */ (feature?.properties ?? {})
    const dimLabel = featureDimensionRawLabel(xAxisItem, /** @type {QuarterSectionFeatureProperties} */ (p), i)
    const seriesLabel = colorItem ? featureSeriesRawLabel(colorItem, p) : ''
    const key = colorItem ? `${dimLabel}\0${seriesLabel}` : dimLabel

    let b = buckets.get(key)
    if (!b) {
      b = { dimLabel, seriesLabel, samples: [] }
      buckets.set(key, b)
    }
    const sample = measureSample(yAxisItem, p)
    if (yAxisItem.id === 'meas-avg-dbh' && !Number.isFinite(sample)) continue
    if (yAxisItem.id === 'meas-max-priority' && !Number.isFinite(sample)) continue
    b.samples.push(sample)
  }

  /** @type {Array<{ xLabel: string, yValue: number, series?: string }>} */
  const rows = []
  for (const b of buckets.values()) {
    const yValue = reduceAgg(b.samples, yAggregation)
    const xLabel = b.dimLabel
    const row = { xLabel, yValue }
    if (colorItem) row.series = b.seriesLabel === '' ? 'Unknown' : b.seriesLabel
    rows.push(row)
  }

  rows.sort((a, b) => {
    const cx = String(a.xLabel).localeCompare(String(b.xLabel))
    if (cx !== 0) return cx
    const sa = a.series != null ? String(a.series) : ''
    const sb = b.series != null ? String(b.series) : ''
    return sa.localeCompare(sb)
  })
  return rows
}

/**
 * @param {{
 *   features: { properties?: QuarterSectionFeatureProperties }[]
 *   xAxisItem: Variable
 *   yAxisItem: Variable
 *   yAggregation: Aggregation
 *   colorItem: Variable | null
 *   draftFilters: DraftFilter[]
 * }} opts
 */
export function executeClientAnalyticsQuery(opts) {
  const filtered = applyDraftFilters(opts.features, opts.draftFilters)
  const raw = buildAggregatedChartRows(
    opts.xAxisItem,
    opts.yAxisItem,
    opts.yAggregation,
    opts.colorItem,
    filtered,
  )
  return sanitizeChartRowsForDisplay(raw)
}