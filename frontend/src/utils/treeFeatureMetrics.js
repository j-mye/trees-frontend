/**
 * Read model/feature fields from a getTreesByQs tree row (trees_features-backed).
 * @param {Record<string, unknown> | null | undefined} tree
 */
export function treeImpactOfFailure(tree) {
  const raw = tree?.i_f ?? tree?.I_f
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {Record<string, unknown> | null | undefined} tree
 */
export function treeProbabilityOfFailure(tree) {
  const raw = tree?.p_f ?? tree?.P_f
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {Record<string, unknown> | null | undefined} tree
 */
export function treeAgePrioritization(tree) {
  const raw = tree?.a_p ?? tree?.age_prioritization
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {number | null | undefined} value
 * @param {number} [digits]
 */
export function formatTreeMetric(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}
