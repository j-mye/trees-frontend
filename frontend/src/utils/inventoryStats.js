/**
 * @param {string | null | undefined} species
 */
export function normalizeSpeciesLabel(species) {
  const s = String(species ?? '').trim()
  return s || 'Unknown'
}

/**
 * Species counts for pie chart from loaded tree rows.
 * @param {Array<{ species?: string }>} trees
 * @returns {{ name: string, value: number }[]}
 */
export function speciesBreakdownFromTrees(trees) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const t of trees) {
    const label = normalizeSpeciesLabel(t?.species)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

/**
 * Mean last-pruned year (or numeric value) across trees with a recorded value.
 * @param {Array<{ last_pruned?: number }>} trees
 * @returns {number | null}
 */
export function averageLastPrunedFromTrees(trees) {
  const values = trees
    .map((t) => Number(t?.last_pruned))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * @param {number | null | undefined} value
 */
export function formatAvgLastPruned(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1900) return String(Math.round(n))
  return n.toFixed(1)
}

/**
 * @param {Record<string, unknown> | null | undefined} properties
 * @returns {number | null}
 */
export function avgLastPrunedFromSummaryProperties(properties) {
  const raw = properties?.avg_last_pruned ?? properties?.avgLastPruned
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Prefer tree-level average when trees are loaded; otherwise use QS summary property.
 * @param {Record<string, unknown> | null | undefined} qs
 * @param {Array<{ last_pruned?: number }>} trees
 */
export function resolveQsAvgLastPruned(qs, trees) {
  return averageLastPrunedFromTrees(trees) ?? avgLastPrunedFromSummaryProperties(qs)
}

/**
 * @param {Record<string, unknown> | null | undefined} qs
 * @param {Array<{ priority_score?: number, dbh?: number, can_strike_building?: boolean, last_pruned?: number }>} trees
 * @param {number | null} displayAverageDbh
 */
export function buildQsInventoryStats(qs, trees, displayAverageDbh) {
  const treeCount = Number(qs?.tree_count ?? qs?.total_trees ?? trees.length) || 0
  const scores = trees
    .map((t) => Number(t?.priority_score))
    .filter((n) => Number.isFinite(n))
  const avgPriority =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const strikeCount = trees.filter((t) => Boolean(t?.can_strike_building)).length
  const speciesRows = speciesBreakdownFromTrees(trees)
  return {
    treeCount,
    avgPriority: avgPriority != null && Number.isFinite(avgPriority) ? avgPriority : null,
    strikeCount,
    speciesCount: speciesRows.length,
    dominantSpecies: speciesRows[0]?.name ?? String(qs?.top_species ?? 'Unknown'),
    displayAverageDbh,
    psCritical: Number(qs?.PS_critical ?? 0),
    psBottom90: Number(qs?.PS_bottom90 ?? 0),
    psBackground: Number(qs?.PS_background ?? 0),
    psComposite: Number(qs?._psCompositeDisplay ?? qs?.PS_composite ?? 0),
    priorityLevel: String(qs?._map_level ?? qs?.priority_level ?? '').trim() || 'Low',
    district: String(qs?.district ?? 'Unknown'),
    inspectionYear: String(qs?.inspection_year ?? '—'),
    avgLastPruned: resolveQsAvgLastPruned(qs, trees),
  }
}

/** Tree-level priority_score from trees_features is on a 0–1 scale. */
export const TREE_PRIORITY_SCORE_MAX = 1

/**
 * @param {number | null | undefined} value
 * @param {number} [digits]
 */
export function formatTreePriorityScore(value, digits = 3) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

/**
 * Histogram of tree-level priority scores (0–1) for a quarter section bar chart.
 * @param {Array<{ priority_score?: number }>} trees
 * @param {number} [binWidth] bucket width on 0–1 scale (default 0.1)
 * @returns {{ name: string, value: number }[]}
 */
export function priorityScoreHistogramFromTrees(trees, binWidth = 0.1) {
  const scores = trees
    .map((t) => Number(t?.priority_score))
    .filter((n) => Number.isFinite(n))
  if (!scores.length) return []

  const width = Math.max(0.05, Math.min(0.25, binWidth))
  /** @type {Map<number, number>} */
  const bins = new Map()
  for (const s of scores) {
    const clamped = Math.max(0, Math.min(TREE_PRIORITY_SCORE_MAX, s))
    const start = Math.floor((clamped + 1e-9) / width) * width
    const key = Math.round(start * 100) / 100
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => {
      const end = Math.min(Math.round((start + width) * 100) / 100, TREE_PRIORITY_SCORE_MAX)
      return {
        name: `${start.toFixed(2)}–${end.toFixed(2)}`,
        value: count,
      }
    })
}

/**
 * Histogram of estimated tree age (years) for a quarter section bar chart.
 * @param {Array<{ age?: number }>} trees
 * @param {number} [binWidthYears]
 * @returns {{ name: string, value: number }[]}
 */
export function estimatedAgeHistogramFromTrees(trees, binWidthYears = 10) {
  const ages = trees
    .map((t) => Number(t?.age))
    .filter((n) => Number.isFinite(n) && n >= 0)
  if (!ages.length) return []

  const maxObserved = Math.max(...ages)
  const width = Math.max(
    5,
    Math.min(
      binWidthYears,
      maxObserved <= 25 ? 5 : maxObserved <= 60 ? 10 : 15,
    ),
  )
  /** @type {Map<number, number>} */
  const bins = new Map()
  for (const age of ages) {
    const clamped = Math.min(age, 200)
    const start = Math.floor(clamped / width) * width
    bins.set(start, (bins.get(start) ?? 0) + 1)
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => {
      const end = start + width - 1
      return {
        name: start === end ? `${start} yr` : `${start}–${end} yr`,
        value: count,
      }
    })
}

/**
 * @param {string} feature
 */
export function formatShapFeatureLabel(feature) {
  return String(feature)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
