/**
 * Client-side analytics execution (same summaries GeoJSON as the map).
 *
 * @typedef {import('./types.js').Variable} Variable
 * @typedef {import('./types.js').Aggregation} Aggregation
 * @typedef {import('./types.js').DraftFilter} DraftFilter
 */

import {
  CATALOG_DIMENSIONS,
  CATALOG_FILTERS,
  CATALOG_MEASURES,
  catalogColumnForFieldId,
  defaultAggregationForMeasureId,
} from './fieldCatalog.js'
import { FILTER_QUARTER_SECTION_ID } from './fieldCatalog.js'
import { parseInFilterValues } from './filterUtils.js'
import { quarterSectionIdFromProperties } from './quarterSectionId.js'
import { labelForGroupingCell, sanitizeChartRowsForDisplay } from './sanitizeChart.js'

const CATALOG_ALL = [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES, ...CATALOG_FILTERS]

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

export function featureDimensionRawLabel(xAxisItem, p, index) {
  if (xAxisItem.id === 'dim-quarter-section') {
    const id = quarterSectionIdFromProperties(p)
    return id ? labelForGroupingCell(id) : `QS-${index + 1}`
  }
  if (xAxisItem.id === 'dim-priority-level') return labelForGroupingCell(p.priority_level ?? 'Low')
  if (xAxisItem.id === 'dim-species') return labelForGroupingCell(p.top_species)
  if (xAxisItem.id === 'dim-district') return labelForGroupingCell(p.district)
  if (xAxisItem.id === 'dim-inspection-year') {
    const raw = p.inspection_year
    if (raw === undefined || raw === null || String(raw).trim() === '') return 'Unknown'
    return String(raw)
  }
  const key = geoPropertyKeyForFieldId(xAxisItem.id)
  if (key in p) return labelForGroupingCell(p[key])
  return 'Unknown'
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
  const key = geoPropertyKeyForFieldId(yAxisItem.id)
  const v = Number(p[key])
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
  return catalogColumnForFieldId(fieldId)
}

/**
 * @param {Record<string, unknown>} p
 * @param {DraftFilter} f
 */
function filterPropertyString(p, fieldId) {
  if (fieldId === FILTER_QUARTER_SECTION_ID || fieldId === 'dim-quarter-section') {
    return quarterSectionIdFromProperties(p)
  }
  const key = geoPropertyKeyForFieldId(fieldId)
  return String(p[key] ?? '').trim()
}

function rowMatchesFilter(p, f, allFilters) {
  const str = filterPropertyString(p, f.fieldId)
  const raw = p[geoPropertyKeyForFieldId(f.fieldId)]
  const cell = Number(raw)
  const num = Number.isFinite(cell) && raw !== '' && raw != null ? cell : NaN
  const v = Number(f.value)
  if (f.op === 'in') {
    const allowed = parseInFilterValues(allFilters, f.fieldId)
    if (!allowed.length) return true
    const allowedSet = new Set(allowed.map((a) => String(a).trim()).filter(Boolean))
    return allowedSet.has(str)
  }
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
    return filters.every((f) => rowMatchesFilter(p, f, filters))
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
    if (dimLabel === null) continue
    const seriesLabel = colorItem ? featureSeriesRawLabel(colorItem, p) : ''
    const key = colorItem ? `${dimLabel}\0${seriesLabel}` : dimLabel

    let b = buckets.get(key)
    if (!b) {
      b = { dimLabel, seriesLabel, samples: [] }
      buckets.set(key, b)
    }
    const sample = measureSample(yAxisItem, p)
    if (yAxisItem.id !== 'meas-tree-count' && !Number.isFinite(sample)) continue
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
  let yAggregation = opts.yAggregation
  if (yAggregation === 'VALUE') {
    yAggregation = defaultAggregationForMeasureId(opts.yAxisItem.id)
  }
  const filtered = applyDraftFilters(opts.features, opts.draftFilters)

  if (opts.draftFilters.length > 0) {
    console.info('[analytics] filter applied', {
      totalFeatures: opts.features.length,
      filteredFeatures: filtered.length,
      filters: opts.draftFilters.map((f) => ({
        fieldId: f.fieldId,
        op: f.op,
        values: f.values ?? f.value,
      })),
      sampleFilteredQsIds: filtered.slice(0, 5).map((feat) => feat?.properties?.qs_id),
    })
  }

  const raw = buildAggregatedChartRows(
    opts.xAxisItem,
    opts.yAxisItem,
    yAggregation,
    opts.colorItem,
    filtered,
  )

  if (raw.length === 0 && filtered.length > 0) {
    console.warn('[analytics] aggregation produced 0 rows from', filtered.length, 'features — check measure key / dimension fallback')
  } else if (raw.length > 0 && raw.every((r) => r.yValue === 0) && filtered.length > 0) {
    const measureKey = geoPropertyKeyForFieldId(opts.yAxisItem.id)
    const sampleProps = filtered[0]?.properties ?? {}
    console.warn('[analytics] all aggregated values are 0 — measure key:', measureKey, '— exists in sample feature?', measureKey in sampleProps)
  }

  return sanitizeChartRowsForDisplay(raw)
}