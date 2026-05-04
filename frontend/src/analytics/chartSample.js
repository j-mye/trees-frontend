/**
 * Uniform stride downsampling for Recharts — avoids rendering 10k+ SVG elements.
 *
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} rows
 * @param {number} maxPoints
 */
export function downsampleChartRows(rows, maxPoints = 3500) {
  if (!Array.isArray(rows) || rows.length <= maxPoints) {
    return { rows, sampled: false, originalCount: rows?.length ?? 0 }
  }
  const step = Math.ceil(rows.length / maxPoints)
  const out = []
  for (let i = 0; i < rows.length; i += step) {
    out.push(rows[i])
  }
  return { rows: out, sampled: true, originalCount: rows.length, stride: step }
}
