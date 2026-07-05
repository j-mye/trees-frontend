/**
 * SHAP BigQuery table keys on municipal Site ID (e.g. 5232), not tree_row_id / tree_id (0, 1, 2…).
 * @param {Record<string, unknown> | null | undefined} tree Row from getTreesByQs.
 * @returns {string | null}
 */
export function shapSiteIdFromTree(tree) {
  if (!tree || typeof tree !== 'object') return null
  const siteId = String(tree.site_id ?? tree.siteId ?? '').trim()
  return siteId || null
}
