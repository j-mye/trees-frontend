/**
 * Map-related Cloud Function URLs for the React app.
 *
 * Values are injected at build/dev time by Vite from env files in the **frontend**
 * package directory (same folder as `vite.config.js`), e.g. `frontend/.env` and
 * `frontend/.env.local`. Only variables prefixed with `VITE_` are exposed.
 *
 * @see https://vite.dev/guide/env-and-mode.html
 * @see ../../.env.example
 */
export const mapApiEnv = {
  summariesUrl: String(import.meta.env.VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL || '').trim(),
  treesUrl: String(import.meta.env.VITE_CF_GET_TREES_BY_QS_URL || '').trim(),
  /** GET ?site_id= → { english_translation } from BigQuery SHAP table (optional; map panel hides when unset). */
  shapExplanationUrl: String(import.meta.env.VITE_CF_GET_TREE_SHAP_EXPLANATION_URL || '').trim(),
  /** Optional POST endpoint: Draft JSON to tabular rows (BigQuery-backed). */
  analyticsQueryUrl: String(import.meta.env.VITE_CF_ANALYTICS_QUERY_URL || '').trim(),
  /** Optional GET endpoint: field catalog metadata (Phase B). */
  analyticsSchemaUrl: String(import.meta.env.VITE_CF_ANALYTICS_SCHEMA_URL || '').trim(),
}
