/**
 * @typedef {import('./types.js').Variable} Variable
 * @typedef {import('./types.js').DraftFilter} DraftFilter
 * @typedef {import('./types.js').Aggregation} Aggregation
 * @typedef {import('./types.js').ChartType} ChartType
 */

/**
 * @param {{
 *   xAxisItem: Variable | null
 *   yAxisItem: Variable | null
 *   yAggregation: Aggregation | null
 *   colorItem: Variable | null
 *   draftFilters: DraftFilter[]
 *   chartType: ChartType
 * }} draftSlice
 */
export function serializeDraftQuery(draftSlice) {
  const xf = draftSlice.xAxisItem?.id ?? ''
  const yf = draftSlice.yAxisItem?.id ?? ''
  const ya = draftSlice.yAggregation ?? ''
  const cf = draftSlice.colorItem?.id ?? ''
  const ct = draftSlice.chartType
  const filters = [...draftSlice.draftFilters]
    .map((f) => {
      if (f.op === 'in') {
        const vals = Array.isArray(f.values) && f.values.length ? f.values : String(f.value || '').split(/[|,]/)
        return `${f.fieldId}:${f.op}:${vals.map((v) => String(v).trim()).filter(Boolean).sort().join(',')}`
      }
      return `${f.fieldId}:${f.op}:${f.value ?? ''}`
    })
    .sort()
    .join('|')
  return JSON.stringify({ xf, yf, ya, cf, ct, filters })
}

/**
 * @param {{
 *   xAxisItem: Variable | null
 *   yAxisItem: Variable | null
 *   yAggregation: Aggregation | null
 *   colorItem: Variable | null
 * }} s
 */
export function isDraftRunnable(s) {
  return Boolean(s.xAxisItem?.type === 'dimension' && s.yAxisItem?.type === 'measure' && s.yAggregation)
}
