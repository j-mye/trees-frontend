/** @typedef {import('./types.js').DraftFilter} DraftFilter */

export const LEGACY_FILTER_ID_MAP = {
  'dim-quarter-section': 'filter-quarter-section',
  'dim-district': 'filter-district',
}

/** @param {string | null | undefined} label */
export function isUnknownCatalogValue(label) {
  const t = String(label ?? '').trim().toLowerCase()
  return !t || t === 'unknown' || t === 'unk'
}

/**
 * @param {DraftFilter[]} draftFilters
 * @param {string} fieldId
 */
export function parseInFilterValues(draftFilters, fieldId) {
  const f = draftFilters.find((df) => df.fieldId === fieldId)
  if (!f) return []
  if (f.op === 'in') {
    if (Array.isArray(f.values) && f.values.length) return [...f.values]
    return String(f.value || '')
      .split(/[|,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (f.op === 'eq' && f.value) return [String(f.value).trim()]
  return []
}

/**
 * @param {DraftFilter[] | undefined} draftFilters
 */
export function normalizeDraftFilters(draftFilters) {
  if (!Array.isArray(draftFilters)) return []
  return draftFilters.map((f) => {
    const fieldId = LEGACY_FILTER_ID_MAP[f.fieldId] ?? f.fieldId
    if (
      (fieldId === 'filter-quarter-section' || fieldId === 'filter-district') &&
      f.op === 'eq' &&
      f.value
    ) {
      const v = String(f.value).trim()
      return { fieldId, op: 'in', value: v, values: [v] }
    }
    if (f.op === 'in' && (!f.values || !f.values.length) && f.value) {
      const values = String(f.value)
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean)
      return { ...f, fieldId, values }
    }
    return { ...f, fieldId }
  })
}
