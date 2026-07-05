/**
 * Static field catalog aligned to quarter-section GeoJSON properties (summaries API).
 *
 * Only includes fields that are actually present in the quarter-section summary
 * GeoJSON (qs_id, district, priority_level, top_species, inspection_year,
 * tree_count/total_trees, avg_dbh, Priority_Score_Normalized).  Individual-tree
 * columns (height, age, crown_diameter_m, i_f, p_f, etc.) live on the trees table,
 * not on the per-QS summary, so they are intentionally excluded here.
 *
 * @typedef {import('./types.js').CatalogField} CatalogField
 */

/** Scoped filters (not available on X-axis / color). */
export const FILTER_QUARTER_SECTION_ID = 'filter-quarter-section'
export const FILTER_DISTRICT_ID = 'filter-district'

/** @type {CatalogField[]} */
export const CATALOG_FILTERS = [
  { id: FILTER_QUARTER_SECTION_ID, name: 'Quarter Section', type: 'dimension', bqColumn: 'qs_id', valueType: 'string' },
  { id: FILTER_DISTRICT_ID, name: 'District', type: 'dimension', bqColumn: 'district', valueType: 'string' },
]

/** @type {CatalogField[]} */
export const CATALOG_DIMENSIONS = [
  { id: 'dim-species', name: 'Species', type: 'dimension', bqColumn: 'top_species', valueType: 'string' },
  { id: 'dim-priority-level', name: 'Priority Level', type: 'dimension', bqColumn: 'priority_level', valueType: 'string' },
  { id: 'dim-district', name: 'District', type: 'dimension', bqColumn: 'district', valueType: 'string' },
  { id: 'dim-inspection-year', name: 'Inspection Year', type: 'dimension', bqColumn: 'inspection_year', valueType: 'string' },
  { id: 'dim-quarter-section', name: 'Quarter Section', type: 'dimension', bqColumn: 'qs_id', valueType: 'string' },
]

/** @type {CatalogField[]} */
export const CATALOG_MEASURES = [
  { id: 'meas-tree-count', name: 'Tree Count', type: 'measure', bqColumn: 'tree_count', valueType: 'number' },
  { id: 'meas-avg-dbh', name: 'Avg DBH (cm)', type: 'measure', bqColumn: 'avg_dbh', valueType: 'number' },
  { id: 'meas-max-priority', name: 'Max Priority Score', type: 'measure', bqColumn: 'Priority_Score_Normalized', valueType: 'number' },
]

const FILTER_ID_SET = new Set(CATALOG_FILTERS.map((f) => f.id))

/** @param {string} fieldId */
export function isScopedFilterFieldId(fieldId) {
  return FILTER_ID_SET.has(fieldId)
}

/** @param {string} fieldId */
export function catalogColumnForFieldId(fieldId) {
  const c = [...CATALOG_FILTERS, ...CATALOG_DIMENSIONS, ...CATALOG_MEASURES].find((x) => x.id === fieldId)
  return c?.bqColumn ?? fieldId
}

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
