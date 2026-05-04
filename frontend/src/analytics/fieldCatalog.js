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
  { id: 'dim-tree-status', name: 'Tree Status', type: 'dimension', bqColumn: 'tree_status', valueType: 'string' },
  { id: 'dim-risk-to-building', name: 'Can Strike Building', type: 'dimension', bqColumn: 'risk_to_building', valueType: 'string' },
  { id: 'dim-maintenance-band', name: 'Maintenance Band', type: 'dimension', bqColumn: 'maintenance_band', valueType: 'string' },
]

/** @type {CatalogField[]} */
export const CATALOG_MEASURES = [
  { id: 'meas-tree-count', name: 'Tree Count', type: 'measure', bqColumn: 'tree_count', valueType: 'number' },
  { id: 'meas-avg-dbh', name: 'DBH', type: 'measure', bqColumn: 'avg_dbh', valueType: 'number' },
  { id: 'meas-max-priority', name: 'Max Priority Score', type: 'measure', bqColumn: 'Priority_Score_Normalized', valueType: 'number' },
  { id: 'meas-height', name: 'Height', type: 'measure', bqColumn: 'height', valueType: 'number' },
  { id: 'meas-age', name: 'Age', type: 'measure', bqColumn: 'age', valueType: 'number' },
  { id: 'meas-crown-width', name: 'Crown Width', type: 'measure', bqColumn: 'crown_diameter_m', valueType: 'number' },
  { id: 'meas-priority-score', name: 'Priority Score', type: 'measure', bqColumn: 'priority_score', valueType: 'number' },
  { id: 'meas-iof', name: 'Impact of Failure (I_f)', type: 'measure', bqColumn: 'i_f', valueType: 'number' },
  { id: 'meas-p-f', name: 'Probability of Failure (p_f)', type: 'measure', bqColumn: 'p_f', valueType: 'number' },
  { id: 'meas-age-prioritization', name: 'Age Prioritization', type: 'measure', bqColumn: 'age_prioritization', valueType: 'number' },
]

/** @param {CatalogField} f */
export function catalogFieldToVariable(f) {
  return { id: f.id, name: f.name, type: f.type }
}

/** @param {string} measureId */
export function defaultAggregationForMeasureId(measureId) {
  if (measureId === 'meas-tree-count') return 'SUM'
  if (
    measureId === 'meas-avg-dbh' ||
    measureId === 'meas-height' ||
    measureId === 'meas-age' ||
    measureId === 'meas-crown-width' ||
    measureId === 'meas-priority-score' ||
    measureId === 'meas-iof' ||
    measureId === 'meas-p-f' ||
    measureId === 'meas-age-prioritization'
  )
    return 'AVG'
  return 'MAX'
}
