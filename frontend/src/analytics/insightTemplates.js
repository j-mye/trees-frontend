/**
 * Pre-built "Quick Insight" chart configurations.  Each entry maps directly to
 * catalog field IDs so AnalyticsPage can resolve them from the live dimensions /
 * measures arrays and fire a run without any manual builder interaction.
 *
 * @typedef {{
 *   id: string
 *   label: string
 *   icon: string
 *   question: string
 *   xId: string
 *   yId: string
 *   agg: import('./types.js').Aggregation
 *   chartType: import('./types.js').ChartType
 * }} InsightTemplate
 */

/** @type {InsightTemplate[]} */
export const INSIGHT_TEMPLATES = [
  {
    id: 'trees-by-species',
    label: 'Trees by Species',
    icon: 'park',
    question: 'Which species has the most trees?',
    xId: 'dim-species',
    yId: 'meas-tree-count',
    agg: 'SUM',
    chartType: 'bar',
  },
  {
    id: 'trees-by-district',
    label: 'Trees by District',
    icon: 'location_city',
    question: 'Which district has the most trees?',
    xId: 'dim-district',
    yId: 'meas-tree-count',
    agg: 'SUM',
    chartType: 'bar',
  },
  {
    id: 'priority-breakdown',
    label: 'Priority Breakdown',
    icon: 'priority_high',
    question: 'What share of trees are high priority?',
    xId: 'dim-priority-level',
    yId: 'meas-tree-count',
    agg: 'SUM',
    chartType: 'pie',
  },
  {
    id: 'dbh-by-species',
    label: 'Avg Size by Species',
    icon: 'straighten',
    question: 'Which species tend to be the largest?',
    xId: 'dim-species',
    yId: 'meas-avg-dbh',
    agg: 'AVG',
    chartType: 'bar',
  },
  {
    id: 'risk-by-district',
    label: 'Risk Score by District',
    icon: 'warning',
    question: 'Which districts have the highest-risk trees?',
    xId: 'dim-district',
    yId: 'meas-max-priority',
    agg: 'MAX',
    chartType: 'bar',
  },
  {
    id: 'inspections-by-year',
    label: 'Inspections by Year',
    icon: 'calendar_month',
    question: 'When were trees last inspected?',
    xId: 'dim-inspection-year',
    yId: 'meas-tree-count',
    agg: 'SUM',
    chartType: 'bar',
  },
]
