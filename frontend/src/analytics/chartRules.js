/**
 * @typedef {import('./types.js').Variable} Variable
 * @typedef {import('./types.js').ChartType} ChartType
 */

/**
 * @param {{ xAxisItem: Variable | null, yAxisItem: Variable | null, colorItem: Variable | null }} draft
 * @returns {ChartType[]}
 */
export function allowedChartTypes(draft) {
  const hasX = Boolean(draft.xAxisItem)
  const hasY = Boolean(draft.yAxisItem)
  if (!hasX || !hasY) return ['bar', 'line', 'pie', 'scatter', 'histogram']
  /** @type {ChartType[]} */
  const all = ['bar', 'line', 'pie', 'scatter', 'histogram']
  if (draft.colorItem) {
    return all.filter((t) => t !== 'pie' && t !== 'histogram')
  }
  return all
}

/**
 * @param {ChartType} current
 * @param {ChartType[]} allowed
 * @returns {ChartType}
 */
export function pickLegalChartType(current, allowed) {
  if (allowed.includes(current)) return current
  return allowed[0] ?? 'bar'
}

/**
 * @param {ChartType} t
 * @param {ChartType[]} allowed
 * @returns {string | undefined}
 */
export function chartDisabledReason(t, allowed) {
  if (allowed.includes(t)) return undefined
  if (t === 'pie' && !allowed.includes('pie')) return 'Pie is hidden when a Color / Legend split is set'
  return 'Not available for the current fields'
}
