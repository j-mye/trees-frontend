/**
 * Normalise a raw QS ID value to a canonical string.
 * Pure-numeric IDs (1–3 digits) are zero-padded to 3 characters so that
 * integer 3, string "3", and string "003" all compare equal as "003".
 * Non-numeric IDs (e.g. "003N") are passed through unchanged.
 * @param {unknown} raw
 */
function normalizeQsId(raw) {
  const s = String(raw).trim()
  return /^\d{1,3}$/.test(s) ? s.padStart(3, '0') : s
}

/**
 * Canonical quarter-section id from GeoJSON properties (matches map dashboard).
 * @param {Record<string, unknown> | null | undefined} properties
 */
export function quarterSectionIdFromProperties(properties) {
  if (!properties || typeof properties !== 'object') return ''
  if (properties.qs_id != null && String(properties.qs_id).trim() !== '') {
    return normalizeQsId(properties.qs_id)
  }
  if (properties.quarter_section != null && String(properties.quarter_section).trim() !== '') {
    return normalizeQsId(properties.quarter_section)
  }
  if (properties.QTRSEC != null && String(properties.QTRSEC).trim() !== '') {
    return normalizeQsId(properties.QTRSEC)
  }
  return ''
}
