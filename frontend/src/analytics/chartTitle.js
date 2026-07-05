/**
 * @param {object} opts
 * @param {{ name: string } | null | undefined} opts.xAxisItem
 * @param {{ name: string } | null | undefined} opts.yAxisItem
 * @param {string} opts.yAggregation
 * @param {string[]} opts.selectedQuarterSections
 * @param {string[]} opts.selectedDistricts
 */
export function buildAnalyticsChartTitle({
  xAxisItem,
  yAxisItem,
  yAggregation,
  selectedQuarterSections,
  selectedDistricts,
}) {
  const parts = []
  if (yAxisItem?.name) {
    parts.push(`${yAxisItem.name} (${yAggregation})`)
  }
  if (xAxisItem?.name) {
    parts.push(`by ${xAxisItem.name}`)
  }
  if (selectedQuarterSections.length) {
    const qs =
      selectedQuarterSections.length <= 3
        ? selectedQuarterSections.join(', ')
        : `${selectedQuarterSections.length} quarter sections`
    parts.push(`QS: ${qs}`)
  }
  if (selectedDistricts.length) {
    const d =
      selectedDistricts.length <= 3
        ? selectedDistricts.join(', ')
        : `${selectedDistricts.length} districts`
    parts.push(`District: ${d}`)
  }
  return parts.length ? parts.join(' · ') : ''
}
