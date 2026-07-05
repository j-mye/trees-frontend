/**
 * Shared MapLibre paint expressions and GeoJSON helpers for QS priority maps.
 *
 * Fill paint still grays out `tree_count <= 0` polygons; the map dashboard additionally
 * applies a native layer `filter` so empty QSs can be hidden without refetching GeoJSON.
 */

export const DEFAULT_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/** Same thresholds as map dashboard sidebar for checkbox / filter consistency. */
export function priorityLabelFromScore(score) {
  const numericScore = Number(score) || 0
  if (numericScore >= 70) return 'Critical'
  if (numericScore >= 50) return 'High'
  if (numericScore >= 30) return 'Medium'
  return 'Low'
}

/**
 * Effective priority level for filtering (matches legacy map logic: API field wins, else score).
 * @param {Record<string, unknown>} properties
 */
export function effectivePriorityLevelFromProperties(properties) {
  if (!properties) return 'Low'
  const tuned = properties._map_level
  if (tuned != null && String(tuned).trim() !== '') return String(tuned).trim()
  const raw = properties.priority_level
  if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  return 'Low'
}

/** Tree count for map paint/filters: `tree_count` with `total_trees` fallback (legacy API). */
export const qsMapTreeCountExpr = [
  'to-number',
  ['coalesce', ['get', 'tree_count'], ['get', 'total_trees'], 0],
  0,
]

/** Normalized priority score as a number for fill binning / filters (strings coerced; NaN → 0). */
export const qsMapScoreExpr = ['to-number', ['coalesce', ['get', 'Priority_Score_Normalized'], 0], 0]

/** Display score after client-side k / critical-sway tuning; falls back to stored normalized score. */
export const qsMapDisplayScoreExpr = [
  'to-number',
  ['coalesce', ['get', '_displayPriorityScore'], ['get', 'Priority_Score_Normalized'], 0],
  0,
]

/** Green → yellow → orange → red → deep red. Extra steps in orange/red (less range for green). */
export const COLORS = [
  '#a8e6cf',
  '#b8e0a8',
  '#c8d987',
  '#d9d066',
  '#e8c547',
  '#f5b832',
  '#f5a623',
  '#f5931a',
  '#f47f17',
  '#ef6c1a',
  '#e85d24',
  '#e04e2d',
  '#d63a31',
  '#c02828',
  '#8b0000',
]

/** >1 compresses green/yellow and spreads orange → deep red across the bulk of scores. */
const COLOR_CURVE_GAMMA = 2.4

/**
 * Linear score fraction in [min, max] → 0–1 color unit (power curve favors orange/red band).
 */
export function scoreToColorUnit(score, minScore, maxScore) {
  const value = Number(score)
  const min = Number(minScore)
  const max = Number(maxScore)
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return 0
  }
  const u = Math.max(0, Math.min(1, (Math.max(min, Math.min(max, value)) - min) / (max - min)))
  return Math.pow(u, COLOR_CURVE_GAMMA)
}

/** Score thresholds for discrete bins — more bins land in orange/red than green/yellow. */
function powerSpacedBinThresholds(min, max, binCount) {
  /** @type {number[]} */
  const thresholds = []
  for (let k = 1; k < binCount; k++) {
    const t = k / binCount
    const u = Math.pow(t, 1 / COLOR_CURVE_GAMMA)
    thresholds.push(min + u * (max - min))
  }
  return thresholds
}

/** Map a 0–1 value to a color from {@link COLORS} (for tables / legends). */
export function colorFromUnitInterval(t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0))
  const idx = Math.min(COLORS.length - 1, Math.floor(clamped * (COLORS.length - 1)))
  return COLORS[idx]
}

/** PS composite → palette color using the same power curve as map fill bins. */
export function colorFromScore(score, minScore, maxScore) {
  return colorFromUnitInterval(scoreToColorUnit(score, minScore, maxScore))
}

/** PS composite pressure (tuned when present). Primary map metric. */
export const qsMapPsCompositeExpr = [
  'to-number',
  [
    'coalesce',
    ['get', '_psCompositeDisplay'],
    ['get', '_colorScore'],
    ['get', 'PS_composite'],
    0,
  ],
  0,
]

/** @deprecated Use {@link qsMapPsCompositeExpr} for map color and filters. */
export const qsMapColorScoreExpr = qsMapPsCompositeExpr

/**
 * Build a `fill-color` expression that maps each QS score linearly from `minScore` to `maxScore`
 * across {@link COLORS}. Uses loaded-data bounds so the full palette spans the
 * active range instead of a fixed 0–100 domain.
 */
export function buildDynamicFillExpression(minScore, maxScore) {
  let min = Number(minScore)
  let max = Number(maxScore)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    min = 0
    max = 100
  }
  const colors = COLORS
  const thresholds = powerSpacedBinThresholds(min, max, colors.length)
  const stops = [min, colors[0]]
  for (let i = 1; i < colors.length - 1; i++) {
    stops.push(thresholds[i - 1], colors[i])
  }
  stops.push(max, colors[colors.length - 1])
  return [
    'case',
    ['<=', qsMapTreeCountExpr, 0],
    '#e2e8f0',
    ['<=', qsMapPsCompositeExpr, 0],
    '#e2e8f0',
    ['interpolate', ['linear'], qsMapPsCompositeExpr, ...stops],
  ]
}

/**
 * @param {number[]} sortedAsc
 * @param {number} p 0..1
 */
function percentileFromSorted(sortedAsc, p) {
  if (!sortedAsc.length) return 0
  const clamped = Math.max(0, Math.min(1, p))
  const idx = (sortedAsc.length - 1) * clamped
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

function readMapScoreFromProperties(properties, scoreProperty) {
  const p = properties || {}
  if (scoreProperty) {
    const direct = Number(p[scoreProperty])
    if (Number.isFinite(direct) && direct > 0) return direct
  }
  const tuned = Number(p._psCompositeDisplay ?? p._colorScore)
  if (Number.isFinite(tuned) && tuned > 0) return tuned
  const raw = Number(p.PS_composite)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * Min/max for 15 equal-width score bins on loaded GeoJSON.
 * Uses display score when present; optionally clips to percentiles to reduce red-heavy maps.
 * @param {import('geojson').FeatureCollection | null | undefined} geojson
 * @param {{
 *   scoreProperty?: string
 *   usePercentile?: boolean
 *   lowPct?: number
 *   highPct?: number
 * }} [options]
 * @returns {{ min: number, max: number }}
 */
export function computeQsScoreBinBounds(geojson, options = {}) {
  const scoreProperty = options.scoreProperty ?? '_psCompositeDisplay'
  const features = Array.isArray(geojson?.features) ? geojson.features : []
  const scores = features
    .filter((f) => {
      const tc = Number(f.properties?.tree_count ?? f.properties?.total_trees ?? 0) || 0
      return tc > 0
    })
    .map((f) => readMapScoreFromProperties(f.properties, scoreProperty))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!scores.length) return { min: 0, max: 100 }

  if (options.usePercentile) {
    const sorted = [...scores].sort((a, b) => a - b)
    const low = options.lowPct ?? 10
    const high = options.highPct ?? 90
    const min = percentileFromSorted(sorted, low / 100)
    const max = percentileFromSorted(sorted, high / 100)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return { min: 0, max: 100 }
    }
    return { min, max }
  }

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  if (min >= max) return { min: 0, max: 100 }
  return { min, max }
}

/** Small LRU-ish cache so identical (min,max) pairs reuse the same expression array reference. */
const discreteQsFillExprCache = new Map()
const DISCRETE_FILL_EXPR_CACHE_MAX = 8

/**
 * `fill-color` expression: gray when no trees or missing score; otherwise exactly one of {@link COLORS}
 * from 15 equal-width bins on `[minScore, maxScore]` (score clamped to that interval in the expression).
 * @param {number} minScore
 * @param {number} maxScore
 * @returns {import('maplibre-gl').DataDrivenPropertyValueSpecification<string>}
 */
export function buildDiscreteQsFillExpression(minScore, maxScore) {
  let min = Number(minScore)
  let max = Number(maxScore)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    min = 0
    max = 100
  }
  const key = `${min}|${max}`
  const cached = discreteQsFillExprCache.get(key)
  if (cached) {
    discreteQsFillExprCache.delete(key)
    discreteQsFillExprCache.set(key, cached)
    return cached
  }
  if (discreteQsFillExprCache.size >= DISCRETE_FILL_EXPR_CACHE_MAX) {
    const oldest = discreteQsFillExprCache.keys().next().value
    discreteQsFillExprCache.delete(oldest)
  }
  const thresholds = powerSpacedBinThresholds(min, max, COLORS.length)
  const clampedScore = ['max', min, ['min', max, qsMapPsCompositeExpr]]
  /** @type {unknown[]} */
  const branches = []
  for (let k = 0; k < thresholds.length; k++) {
    branches.push(['<=', clampedScore, thresholds[k]])
    branches.push(COLORS[k])
  }
  const expr = [
    'case',
    ['<=', qsMapTreeCountExpr, 0],
    '#e2e8f0',
    ['<=', qsMapPsCompositeExpr, 0],
    '#e2e8f0',
    ...branches,
    COLORS[COLORS.length - 1],
  ]
  discreteQsFillExprCache.set(key, expr)
  return expr
}

/** Default 0–100 bins for legacy imports; prefer {@link buildDiscreteQsFillExpression} from data bounds. */
export const qsFillExpression = buildDiscreteQsFillExpression(0, 100)

/** @deprecated Use `buildDiscreteQsFillExpression` or `qsFillExpression`; kept for existing imports. */
export const priorityFillExpression = qsFillExpression

/** Line layer for QS polygon outlines. */
export const qsLinePaint = {
  'line-color': '#2c3e50',
  'line-width': 1,
  'line-opacity': 0.6,
}

/**
 * True when a feature has polygon geometry suitable for MapLibre fill/line layers.
 * @param {import('geojson').Feature | null | undefined} feature
 */
export function featureHasMapGeometry(feature) {
  const g = feature?.geometry
  if (!g || typeof g !== 'object') return false
  return g.type === 'Polygon' || g.type === 'MultiPolygon'
}

/**
 * FeatureCollection containing only features with renderable polygon geometry.
 * @param {import('geojson').FeatureCollection | null | undefined} geojson
 */
export function geojsonWithMapGeometryOnly(geojson) {
  if (!geojson?.features) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    ...geojson,
    features: geojson.features.filter((f) => featureHasMapGeometry(f)),
  }
}

/**
 * Prefers spatial `tree_count`; falls back to `total_trees` for legacy payloads.
 * @param {import('geojson').FeatureCollection} geojson
 */
export function buildQsLabelPoints(geojson) {
  const features = (geojson?.features || []).map((f) => {
    const p = f.properties || {}
    const lon = p.center_lon
    const lat = p.center_lat
    if (lon == null || lat == null) return null

    const qs = String(p.qs_id ?? p.QTRSEC ?? p.quarter_section ?? '')
    const count =
      p.tree_count != null && String(p.tree_count).trim() !== ''
        ? Number(p.tree_count) || 0
        : Number(p.total_trees ?? 0) || 0
    const rawScore =
      p._psCompositeDisplay ?? p._colorScore ?? p.PS_composite
    const scoreText =
      rawScore != null && Number(rawScore) > 0 ? Number(rawScore).toFixed(2) : 'N/A'
    const label = count <= 0 ? `${qs} (0 Trees)` : `${qs} (PS: ${scoreText})`

    return {
      type: 'Feature',
      properties: {
        label,
        _map_level: effectivePriorityLevelFromProperties(p),
        district: p.district,
        tree_count: p.tree_count,
        total_trees: p.total_trees,
        PS_composite: p._psCompositeDisplay ?? p.PS_composite,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(lon), Number(lat)],
      },
    }
  })

  return {
    type: 'FeatureCollection',
    features: features.filter(Boolean),
  }
}

/** MapLibre filter: quarter sections with at least one tree. */
export const qsHasTreesMapFilter = ['>', qsMapTreeCountExpr, 0]

/**
 * MapLibre filter: QSs with trees, minimum tree count, priority score in [min, max], and optional district.
 * Uses {@link qsMapScoreExpr} (missing score → 0), same as fill paint.
 * @param {{
 *   psMin: number
 *   psMax: number
 *   treeMin: number
 *   district?: string
 * }} opts
 * `district`: `'all'` shows every district; `'Unknown'` matches empty/missing/`Unknown`; else exact string match.
 * @returns {import('maplibre-gl').FilterSpecification}
 */
export function buildQsScoreTreeMinVisibilityFilter(opts) {
  const { psMin, psMax, treeMin, district } = opts
  const min = Number(psMin)
  const max = Number(psMax)
  const tMin = Number(treeMin)
  const districtExpr = ['to-string', ['coalesce', ['get', 'district'], '']]
  const clauses = /** @type {import('maplibre-gl').FilterSpecification[]} */ ([
    ['>', qsMapTreeCountExpr, 0],
    ['>=', qsMapTreeCountExpr, Number.isFinite(tMin) ? tMin : 0],
    ['>=', qsMapPsCompositeExpr, Number.isFinite(min) ? min : 0],
    ['<=', qsMapPsCompositeExpr, Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER],
  ])

  const d = district != null && String(district).trim() !== '' ? String(district).trim() : 'all'
  if (d !== 'all') {
    if (d === 'Unknown') {
      clauses.push([
        'any',
        ['==', districtExpr, ''],
        ['==', districtExpr, 'Unknown'],
      ])
    } else {
      clauses.push(['==', districtExpr, d])
    }
  }

  return ['all', ...clauses]
}

/**
 * Client-side predicate matching {@link qsHasTreesMapFilter} (for empty-map checks when no QS has trees).
 * @param {import('geojson').Feature} feature
 */
export function featureQsHasTrees(feature) {
  const props = feature?.properties || {}
  const treeCount = Number(props.tree_count ?? props.total_trees ?? 0) || 0
  return treeCount > 0
}

/**
 * Client-side predicate matching {@link buildQsScoreTreeMinVisibilityFilter}.
 * @param {import('geojson').Feature} feature
 * @param {{
 *   psMin: number
 *   psMax: number
 *   treeMin: number
 *   district?: string
 * }} state
 */
export function featureMatchesScoreTreeMinFilters(feature, state) {
  const props = feature?.properties || {}
  const treeCount = Number(props.tree_count ?? props.total_trees ?? 0) || 0
  if (treeCount <= 0) return false
  if (treeCount < (Number(state.treeMin) || 0)) return false

  const score = readMapScoreFromProperties(props, '_psCompositeDisplay')
  if (score < (Number(state.psMin) || 0)) return false
  const maxScore = Number(state.psMax)
  if (score > (Number.isFinite(maxScore) ? maxScore : Number.MAX_SAFE_INTEGER)) return false

  const distFilter =
    state.district != null && String(state.district).trim() !== '' ? String(state.district).trim() : 'all'
  if (distFilter !== 'all') {
    const d = String(props.district ?? '').trim()
    if (distFilter === 'Unknown') {
      if (d !== '' && d !== 'Unknown') return false
    } else if (d !== distFilter) {
      return false
    }
  }

  return true
}

/**
 * Clone GeoJSON with `_map_level` on each feature (priority level for labeling / tooling).
 * @param {import('geojson').FeatureCollection | null} geojson
 */
export function enrichQsGeojsonWithMapLevel(geojson) {
  if (!geojson?.features) return null
  return {
    ...geojson,
    features: geojson.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _map_level: effectivePriorityLevelFromProperties(f.properties || {}),
      },
    })),
  }
}

// Compatibility aliases for legacy imports (standardizing on priority terminology).
export const riskFillExpression = qsFillExpression
