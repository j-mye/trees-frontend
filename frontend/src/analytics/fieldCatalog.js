/**
 * Static field catalog aligned to quarter-section GeoJSON properties (summaries API).
 * v1 custom measures: combine exactly two whitelisted numeric fields with '*' or '+' only; validate server-side in BigQuery path.
 *
 * @typedef {import('./types.js').CatalogField} CatalogField
 */

/** @type {CatalogField[]} */
export const CATALOG_DIMENSIONS = [
  { id: 'dim-species', name: 'Species', type: 'dimension', bqColumn: 'top_species', valueType: 'string' },
  { id: 'dim-district', name: 'District', type: 'dimension', bqColumn: 'district', valueType: 'string' },
  { id: 'dim-priority-level', name: 'Priority Level', type: 'dimension', bqColumn: 'priority_level', valueType: 'string' },
  { id: 'dim-inspection-year', name: 'Inspection Year', type: 'dimension', bqColumn: 'inspection_year', valueType: 'string' },
]

/** @type {CatalogField[]} */
export const CATALOG_MEASURES = [
  { id: 'meas-tree-count', name: 'Tree Count', type: 'measure', bqColumn: 'tree_count', valueType: 'number' },
  { id: 'meas-avg-dbh', name: 'Average DBH', type: 'measure', bqColumn: 'avg_dbh', valueType: 'number' },
  { id: 'meas-max-priority', name: 'Max Priority Score', type: 'measure', bqColumn: 'Priority_Score_Normalized', valueType: 'number' },
]

/** @param {CatalogField} f */
export function catalogFieldToVariable(f) {
  return { id: f.id, name: f.name, type: f.type }
}

/** @param {string} measureId */
export function defaultAggregationForMeasureId(measureId) {
  if (measureId === 'meas-tree-count') return 'SUM'
  if (measureId === 'meas-avg-dbh') return 'AVG'
  return 'MAX'
}
