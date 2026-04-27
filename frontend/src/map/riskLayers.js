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
  const raw = properties.priority_level
  if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  return priorityLabelFromScore(properties.Priority_Score_Normalized)
}

/** Tree count for map paint/filters: `tree_count` with `total_trees` fallback (legacy API). */
export const qsMapTreeCountExpr = [
  'to-number',
  ['coalesce', ['get', 'tree_count'], ['get', 'total_trees'], 0],
  0,
]

/** Normalized priority score as a number for fill binning / filters (strings coerced; NaN → 0). */
export const qsMapScoreExpr = ['to-number', ['coalesce', ['get', 'Priority_Score_Normalized'], 0], 0]

/** Green-to-red ramp: {@link buildDiscreteQsFillExpression} maps each QS to exactly one of these 15 colors. */
export const COLORS = [
  '#a8e6cf',
  '#bae4c4',
  '#cce2b9',
  '#dde0ad',
  '#efdea2',
  '#ffdc97',
  '#ffcc95',
  '#ffbc94',
  '#ffac92',
  '#ff9c91',
  '#ff8b8f',
  '#ff7b8d',
  '#ff6b8c',
  '#ff5b8a',
  '#ff4b89',
]

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
  const stepSize = (max - min) / (colors.length - 1)
  const stops = []
  for (let i = 0; i < colors.length; i++) {
    stops.push(min + i * stepSize)
    stops.push(colors[i])
  }
  return [
    'case',
    ['<=', qsMapTreeCountExpr, 0],
    '#e2e8f0',
    ['!', ['has', 'Priority_Score_Normalized']],
    '#e2e8f0',
    ['interpolate', ['linear'], qsMapScoreExpr, ...stops],
  ]
}

/**
 * Min/max for 15 equal-width score bins on loaded GeoJSON.
 * Uses only `Priority_Score_Normalized > 0` among quarter sections with trees so zeros do not collapse the range.
 * @param {import('geojson').FeatureCollection | null | undefined} geojson
 * @returns {{ min: number, max: number }}
 */
export function computeQsScoreBinBounds(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : []
  const scores = features
    .filter((f) => {
      const tc = Number(f.properties?.tree_count ?? f.properties?.total_trees ?? 0) || 0
      return tc > 0
    })
    .map((f) => Number(f.properties?.Priority_Score_Normalized))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!scores.length) return { min: 0, max: 100 }
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
  const width = (max - min) / COLORS.length
  const clampedScore = ['max', min, ['min', max, qsMapScoreExpr]]
  /** @type {unknown[]} */
  const branches = []
  for (let k = 0; k < COLORS.length - 1; k++) {
    branches.push(['<=', clampedScore, min + (k + 1) * width])
    branches.push(COLORS[k])
  }
  const expr = [
    'case',
    ['<=', qsMapTreeCountExpr, 0],
    '#e2e8f0',
    ['!', ['has', 'Priority_Score_Normalized']],
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
 * Point per QS for symbol labels (uses center_lon / center_lat from API).
 * Prefers spatial `tree_count`; falls back to `total_trees` for legacy payloads.
 * @param {import('geojson').FeatureCollection} geojson
 */
export function buildQsLabelPoints(geojson) {
  const features = (geojson?.features || []).map((f) => {
    const p = f.properties || {}
    const lon = p.center_lon
    const lat = p.center_lat
    if (lon == null || lat == null) return null

    const qs = String(p.QTRSEC ?? p.quarter_section ?? '')
    const count =
      p.tree_count != null && String(p.tree_count).trim() !== ''
        ? Number(p.tree_count) || 0
        : Number(p.total_trees ?? 0) || 0
    const rawScore = p.Priority_Score_Normalized
    const scoreText = rawScore != null ? Number(rawScore).toFixed(1) : 'N/A'
    const label = count <= 0 ? `${qs} (0 Trees)` : `${qs} (Score: ${scoreText})`

    return {
      type: 'Feature',
      properties: {
        label,
        _map_level: effectivePriorityLevelFromProperties(p),
        district: p.district,
        tree_count: p.tree_count,
        total_trees: p.total_trees,
        Priority_Score_Normalized: p.Priority_Score_Normalized,
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
 *   priorityMin: number
 *   priorityMax: number
 *   treeMin: number
 *   district?: string
 * }} opts
 * `district`: `'all'` shows every district; `'Unknown'` matches empty/missing/`Unknown`; else exact string match.
 * @returns {import('maplibre-gl').FilterSpecification}
 */
export function buildQsScoreTreeMinVisibilityFilter(opts) {
  const { priorityMin, priorityMax, treeMin, district } = opts
  const min = Number(priorityMin)
  const max = Number(priorityMax)
  const tMin = Number(treeMin)
  const districtExpr = ['to-string', ['coalesce', ['get', 'district'], '']]
  const clauses = /** @type {import('maplibre-gl').FilterSpecification[]} */ ([
    ['>', qsMapTreeCountExpr, 0],
    ['>=', qsMapTreeCountExpr, Number.isFinite(tMin) ? tMin : 0],
    ['>=', qsMapScoreExpr, Number.isFinite(min) ? min : 0],
    ['<=', qsMapScoreExpr, Number.isFinite(max) ? max : 100],
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
 *   priorityMin: number
 *   priorityMax: number
 *   treeMin: number
 *   district?: string
 * }} state
 */
export function featureMatchesScoreTreeMinFilters(feature, state) {
  const props = feature?.properties || {}
  const treeCount = Number(props.tree_count ?? props.total_trees ?? 0) || 0
  if (treeCount <= 0) return false
  if (treeCount < (Number(state.treeMin) || 0)) return false

  const score = Number(props.Priority_Score_Normalized) || 0
  if (score < (Number(state.priorityMin) || 0)) return false
  const maxScore = Number(state.priorityMax)
  if (score > (Number.isFinite(maxScore) ? maxScore : 100)) return false

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
