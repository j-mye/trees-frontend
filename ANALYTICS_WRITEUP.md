# Analytics feature — implementation overview

This document summarizes the **Trees** analytics experience: drag-and-drop chart builder, optional BigQuery-backed queries, and client-side fallback using the same quarter-section summaries as the map.

## User-facing behavior

- **Data dictionary (left)**: Dimensions and measures from a fixed catalog (plus user-added labels for exploration). Search filters the list. Items are draggable.
- **Builder (center)**:
  - **X-axis / Group by**: **Dimensions only.** Each row in the result is one value of that dimension (e.g. species, district). Measures cannot be dropped here.
  - **Y-axis / Measure**: **Measures only.** The numeric field to aggregate.
  - **Aggregation**: `SUM`, `AVG`, `COUNT`, `MAX` (per measure defaults where applicable).
  - **Filters**: Any catalog field; operators `=`, `>`, `>=`, `<`, `<=` with numeric or string values as appropriate.
  - **Color / Legend**: Optional **dimension** to split the series (multi-series charts).
- **Canvas (right)**: Chart types include bar, line, pie, scatter, and histogram (subject to rules when color is set). **Run Query** loads data; users can toggle chart type, open a table, export CSV, and use fullscreen on the canvas.
- **Help (info icon)**: Short in-app explanation of dimensions, measures, axes, filters, and chart types.

Persisted builder state (session storage) survives refresh; **Reset** clears draft storage and the last result.

## Execution modes

1. **Remote (preferred when configured)**  
   If `VITE_CF_ANALYTICS_QUERY_URL` is set and the user is signed in, the app `POST`s the current **draft** (axes, aggregation, color, filters) to the `analytics_query` Cloud Function with a Firebase ID token. The function compiles the draft to parameterized BigQuery SQL, runs it, and returns `{ rows, columns?, source }` with rows shaped as `xLabel`, `yValue`, and optional `series`.

2. **Client fallback**  
   If the analytics URL is missing or the user is not authenticated, the app uses the **same GeoJSON features** as the map summaries (`VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL`). It filters features in memory, groups by the chosen **dimension** X, applies the Y aggregation per group (and per series if color is set), then feeds the chart.

In both modes, the UI may **downsample** points for rendering (about 3,500 points) to keep the browser responsive; a banner appears when downsampling applies.

## Frontend modules (high level)

| Area | Role |
|------|------|
| `AnalyticsPage.jsx` | DnD wiring, zone rules (X = dimension, Y = measure, color = dimension), run/export/fullscreen |
| `analyticsStore.js` | Zustand draft + `sessionStorage` persistence, catalog merge, legacy migration, coercion of old `VALUE` aggregation |
| `fieldCatalog.js` | Canonical dimension/measure ids, BigQuery column mapping metadata, default aggregations |
| `draftSerialize.js` | Stable cache key / serialization for React Query |
| `chartRules.js` | Allowed chart types (e.g. pie/histogram hidden when color split is on) |
| `useAnalyticsData.js` | Summaries fetch, `useRunAnalyticsMutation` (remote vs client + downsampling) |
| `remoteAnalytics.js` | POST to `analytics_query` |
| `useAnalyticsSchemaQuery.js` | Optional GET `analytics_schema` for catalog alignment |
| `clientAggregate.js` | GeoJSON → grouped rows (dimension labels from feature properties) |
| `sanitizeChart.js` | Row cleanup for display |
| `chartSample.js` | Downsampling |
| `ChartPreview.jsx` | Recharts; trend line + R² for numeric X when applicable |
| `BuilderPane.jsx` / `CanvasPane.jsx` / `DataDictionaryPane.jsx` | Layout and controls |

## Backend (`database/cloud_functions`)

- **`analytics_query/compiler.py`**: Maps **allowed** dimension and measure ids to **known** BigQuery column names only (no raw user SQL). Builds `SELECT` with `GROUP BY` on normalized dimension expression(s); supports optional second grouping dimension for `series`. Validates aggregation and filter operators; uses query parameters for filter values.
- **`analytics_query/main.py`** (standalone Gen2): CORS headers, Firebase auth, compile + BigQuery job, small LRU cache keyed by draft fingerprint (+ uid), returns JSON rows.
- **`analytics_schema`**: Exposes dimension/measure allowlists for the UI (optional).
- **Monolithic `main.py`**: May host the same `analytics_query` / `analytics_schema` entrypoints for Firebase deploy; behavior mirrors the standalone compiler.

Environment: fully qualified analytics table (e.g. `BQ_ANALYTICS_SOURCE_TABLE` or `BQ_QUARTER_SECTION_TABLE_FQN`).

## Security notes

- Identifiers in SQL come **only** from server-side allowlists (`DIMENSION_TO_COLUMN`, `MEASURE_TO_COLUMN`).
- Filter values are passed as **query parameters**, not string-concatenated into SQL.
- `analytics_query` requires a **valid Firebase ID token**.

## Removed / deferred

- **Measure on X** (binned numeric X, flat row mode, `VALUE` / “Flat” aggregation) is **disabled** in the UI and unsupported in the current compiler. X must be a catalog **dimension**. Legacy persisted drafts that used a measure on X or `VALUE` are migrated to a valid dimension-only X and a standard aggregation on Y.

## Configuration checklist

- Frontend `.env`: `VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL` (summaries), optionally `VITE_CF_ANALYTICS_QUERY_URL`, `VITE_CF_ANALYTICS_SCHEMA_URL`.
- Cloud Function env: BigQuery table FQN, Firebase project alignment, CORS as implemented (manual headers where used; avoid duplicating CORS middleware).

---

*Last updated to match the dimension-only X-axis product decision and the current frontend/backend layout.*
