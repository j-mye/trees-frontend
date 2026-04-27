# Analytics BI module

## Manual QA matrix (smoke)

Run signed-in against a dev project with summaries URL set.

| Case | Steps | Expected |
|------|--------|----------|
| Bar + district + tree SUM | Drag District to X, Tree Count to Y, Run | One bar per district bucket; Y sums trees |
| Aggregation | Set Y agg to AVG / COUNT / MAX, Run | Values change predictably |
| Color split | Add Color dimension, Run | Pie disabled; bar shows composite labels |
| Filters | Drop tree_count filter, set &gt;= 500, Run | Fewer rows than without filter |
| Cache | Same draft Run twice | Second instant (React Query cache) |
| Reset | Reset draft | Storage cleared; empty chart state |
| Schema URL | Set `VITE_CF_ANALYTICS_SCHEMA_URL` | Data Dictionary shows schema hint when GET succeeds |
| Query URL | Set `VITE_CF_ANALYTICS_QUERY_URL` | Run uses remote rows when CF + BQ env configured |

## Layout

- `fieldCatalog.js` — static allowlist (keep in sync with `database/cloud_functions/analytics_query/compiler.py`).
- `analyticsStore.js` — Zustand draft + session persistence.
- `clientAggregate.js` — client execution on GeoJSON (no SQL).
- `useAnalyticsData.js` — summaries `useQuery` + `useMutation` Run Query.

## Regenerate catalog JSON (optional)

```bash
python scripts/export_analytics_catalog.py > frontend/src/analytics/fieldCatalog.generated.json
```
