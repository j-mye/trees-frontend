/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeChartLabel(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s === '') return null
  return s
}

/**
 * Dimension/series bucket label for grouping (missing values -> "Unknown", same as raw GeoJSON conventions).
 * @param {unknown} raw
 */
export function labelForGroupingCell(raw) {
  const s = sanitizeChartLabel(raw)
  return s === null ? 'Unknown' : s
}

/**
 * @param {Array<{ xLabel: unknown, yValue: number, series?: unknown }>} rows
 * @returns {Array<{ xLabel: string, yValue: number, series?: string }>}
 */
export function sanitizeChartRowsForDisplay(rows) {
  if (!Array.isArray(rows)) return []
  /** @type {Array<{ xLabel: string, yValue: number, series?: string }>} */
  const out = []
  for (const r of rows) {
    const xLabel = sanitizeChartLabel(r.xLabel)
    if (xLabel === null) continue
    const row = { xLabel, yValue: Number(r.yValue) || 0 }
    if (r.series !== undefined) {
      const ser = sanitizeChartLabel(r.series)
      if (ser !== null) row.series = ser
    }
    out.push(row)
  }
  return out
}
