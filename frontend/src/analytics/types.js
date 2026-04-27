/**
 * @typedef {'dimension' | 'measure'} FieldKind
 * @typedef {{ id: string, name: string, type: FieldKind, bqColumn?: string, valueType?: 'number' | 'string' }} CatalogField
 * @typedef {{ id: string, name: string, type: FieldKind }} Variable
 * @typedef {'SUM' | 'AVG' | 'COUNT' | 'MAX'} Aggregation
 * @typedef {'eq' | 'gt' | 'lt' | 'gte' | 'lte'} FilterOp
 * @typedef {{ fieldId: string, op: FilterOp, value: string }} DraftFilter
 * @typedef {'bar' | 'line' | 'pie' | 'scatter'} ChartType
 */

export const DRAFT_QUERY_VERSION = 2

/** @type {Array<'SUM' | 'AVG' | 'COUNT' | 'MAX'>} */
export const AGGREGATIONS = ['SUM', 'AVG', 'COUNT', 'MAX']
