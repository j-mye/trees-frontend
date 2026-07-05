# BigQuery schema guide for frontend / graphs

Handoff doc for building UI and **priority-score-over-time** charts. Describes the Milwaukee trees dataset after the TreeKeeper sync refactor.

**Project:** `mke-trees`  
**Dataset:** `mke_tree_dataset`  
**Full design reference:** [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md)

---

## 1. Two layers (read this first)

| Layer | Update pattern | Use in UI |
| ----- | -------------- | --------- |
| **Operational** | MERGE on each weekly sync — always current | Maps, tree detail, live PS, CRUD |
| **Historical** | Append-only on each sync — never updated/deleted | Line charts, trends, “what changed when” |

```
TreeKeeper weekly sync
        │
        ├─► trees_core + trees_features + qs_priority     (live state)
        │
        └─► sync_runs + trees_snapshot_history + qs_priority_history   (time series)
```

After the first successful sync (`tk-2026-06-14T194107Z`), operational tables reflect merged TreeKeeper data; history tables hold one append batch per sync run. **More weekly runs = more points on graphs.**

---

## 2. Renames from legacy tables

If old code still references legacy names:

| Legacy | New | Notes |
| ------ | --- | ----- |
| `tree` | split into `trees_core` + `trees_features` | Do not query `tree` in new UI |
| `tree.tree_row_id` | `trees_core.tree_id` | Primary key for a tree row |
| `quarter_section` | split into `quarter_sections` + `qs_priority` | |
| `quarter_section.QTRSEC` | `quarter_sections.qs_id` | Quarter-section ID (string, e.g. `"262"`) |
| `Site ID` (CSV / TreeKeeper) | `trees_core.site_id` | Inventory site key; **not always equal to `tree_id`** |

Join operational tree + PS:

```sql
SELECT c.*, f.priority_score, f.s_f, f.I_f, f.p_f, f.a_p
FROM `mke-trees.mke_tree_dataset.trees_core` c
JOIN `mke-trees.mke_tree_dataset.trees_features` f
  ON c.tree_id = f.tree_id
WHERE c.site_id = @site_id;
```

Join tree to quarter section:

```sql
SELECT c.site_id, c.tree_id, c.qs_id, q.Priority_Score_Normalized
FROM `mke-trees.mke_tree_dataset.trees_core` c
LEFT JOIN `mke-trees.mke_tree_dataset.qs_priority` q
  ON c.qs_id = q.qs_id;
```

Species labels (when needed):

```sql
JOIN `mke-trees.mke_tree_dataset.species` s ON c.species_id = s.species_id
```

---

## 3. Operational tables (current state)

### `trees_core`

One row per tree. Primary key: **`tree_id`**. Natural inventory key: **`site_id`**.

| Column group | Important columns | Meaning |
| ------------ | ----------------- | ------- |
| Identity | `tree_id`, `site_id`, `qs_id`, `species_id`, `status` | `status` e.g. `Tree`, `Stump`, `No Plant` |
| Location | `latitude`, `longitude`, `address`, `street`, `district`, `census_block_id` | Map + filters |
| Dimensions | `dbh`, `height`, `crown_width`, `growing_space` | inches / feet per legacy conventions |
| Condition | `condition`, `damage`, `disease`, `alder`, `reason_to_remove` | See condition encoding below |
| Pruning | `pruning_cycle`, `last_pruned`, `years_since_pruned`, `maintenance_deficit` | Maintenance context |
| Audit | `created_at`, `updated_at` | Last operational write |

**`condition` encoding (numeric in BQ):**

| Value | Label |
| ----: | ----- |
| 4.0 | excellent |
| 3.0 | good |
| 2.0 | fair |
| 1.0 | poor |
| 0.0 | dead |

Some source rows may still be text before normalization; treat unknown as null in charts.

### `trees_features`

One row per `tree_id`. Priority score model output.

| Column | Meaning |
| ------ | ------- |
| `priority_score` | Main score for UI (0–1, clipped) |
| `priority_score_raw` | Uncapped model output (same as `priority_score` when already in range) |
| `s_f` | Species / failure factor |
| `I_f_raw`, `I_f` | Impact factors |
| `p_f` | Probability factor |
| `a_p` | Age / pruning factor |
| `k1`, `k3` | Integer model constants used in terms |
| `risk_term_k1_I_f_p_f_b` | Risk term in composite score |
| `age_term_k3_a_p` | Age term in composite score |

### `qs_priority`

One row per quarter section (`qs_id`). Rollup of tree-level scores in that QS.

| Column | Meaning |
| ------ | ------- |
| `PS_critical` | Critical-tree component |
| `PS_bottom90` | Bottom-90% component |
| `n` | Tree count used in rollup |
| `PS_background` | Background component |
| `PS_composite` | Combined QS score |
| `Priority_Score_Normalized` | **Primary QS score for maps / ranking** (0–1 scale) |
| `ps_global`, `k`, `critical_weight` | Model metadata / weighting |

### Other operational tables (unchanged by sync)

`users`, `species`, `quarter_sections`, `service_requests`, `service_request_assignees`, `tree_inspections`, `shap` — used for auth, species names, map geometry, work orders, SHAP explainability. TreeKeeper sync does **not** append to these except updating rows in `trees_core`, `trees_features`, `qs_priority`.

---

## 4. Historical tables (for graphs)

### `sync_runs`

One row per weekly sync execution. Use as the **time axis label** or filter.

| Column | Meaning |
| ------ | ------- |
| `sync_run_id` | e.g. `tk-2026-06-14T194107Z` |
| `started_at`, `completed_at` | UTC timestamps |
| `status` | `running`, `success`, `failed` |
| `source` | Always `treekeeper` for this pipeline |
| `trees_fetched` | Rows pulled from TreeKeeper |
| `trees_unchanged` | No comparable field changes |
| `trees_changed` | At least one field merged |
| `trees_new_in_remote` | New TK sites |
| `trees_missing_in_remote` | In baseline, not in TK |
| `trees_ps_recomputed` | Trees with PS recalculated |
| `qs_updated` | Quarter sections with updated rollups |
| `model_version` | PS pipeline version string |
| `error_message` | Set when `status = failed` |

**First successful run:** `tk-2026-06-14T194107Z` (~26,659 tree history rows, 369 QS history rows).

Only **`status = 'success'`** runs should appear on production charts.

---

### `trees_snapshot_history`

**Tree-level time series.** Append one row per **changed or new** site per sync (unchanged trees are **not** logged).

Partitioned by `DATE(recorded_at)`, clustered by `tree_id`, `site_id`.

| Column | Type | Graph use |
| ------ | ---- | --------- |
| `tree_id` | STRING | Join to `trees_core` / `trees_features` |
| `site_id` | STRING | **User-facing TreeKeeper site ID** — prefer for search/filter |
| `sync_run_id` | STRING | Join to `sync_runs` |
| `recorded_at` | TIMESTAMP | **X-axis time** (sync completion time) |
| `qs_id` | STRING | Filter / group by quarter section |
| `status` | STRING | Status transitions over time |
| `dbh`, `height`, `crown_width`, `growing_space` | numeric | Dimension trend lines |
| `condition` | FLOAT64 | Condition trend (see encoding above) |
| `damage` | STRING | Categorical change |
| `priority_score`, `priority_score_raw` | FLOAT64 | **Main PS trend lines** |
| `s_f`, `I_f_raw`, `I_f`, `p_f`, `a_p` | FLOAT64 | Component breakdown charts |
| `k1`, `k3` | INT64 | Model constants |
| `risk_term_k1_I_f_p_f_b`, `age_term_k3_a_p` | FLOAT64 | Term decomposition |
| `alder`, `disease`, `inventory_date`, `pruning_cycle`, `last_pruned`, `years_since_pruned`, `maintenance_deficit`, `property_type`, `site_type`, `reason_to_remove`, `site_comments`, `latitude`, `longitude`, `district`, `species_id` | various | Extended tooltips / future charts; may be **null on early loads** |

**Important semantics**

- Each row is a **snapshot at sync time** for sites that had a delta (merged or new). It is **not** a daily measurement.
- `tree_id` and `site_id` can differ when a site reuses an internal tree row id from the legacy priority CSV.
- v1 history rows captured **pre-merge baseline + PS** state for changed sites (local jsonl uses `"phase": "pre_merge"`; BQ stores normalized columns only).
- **There is no separate BQ row dated ~5 months ago.** See [§9 Baseline vs first sync](#9-baseline-vs-first-sync-two-point-graphs) below.
- After a second weekly sync, `trees_snapshot_history` will have **two real timestamps** per changed tree and normal time-series queries work without synthesis.

**Example — PS over time for one site** (works once ≥2 sync runs exist)

```sql
SELECT
  recorded_at,
  sync_run_id,
  priority_score,
  priority_score_raw,
  dbh,
  height,
  condition,
  status
FROM `mke-trees.mke_tree_dataset.trees_snapshot_history`
WHERE site_id = @site_id
ORDER BY recorded_at;
```

**Example — many trees, one sync**

```sql
SELECT site_id, priority_score, dbh, condition
FROM `mke-trees.mke_tree_dataset.trees_snapshot_history`
WHERE sync_run_id = 'tk-2026-06-14T194107Z'
  AND priority_score IS NOT NULL
ORDER BY priority_score DESC
LIMIT 100;
```

**Example — join sync metadata**

```sql
SELECT
  h.recorded_at,
  r.trees_changed,
  r.trees_ps_recomputed,
  h.site_id,
  h.priority_score
FROM `mke-trees.mke_tree_dataset.trees_snapshot_history` h
JOIN `mke-trees.mke_tree_dataset.sync_runs` r
  USING (sync_run_id)
WHERE r.status = 'success'
  AND h.site_id = @site_id
ORDER BY h.recorded_at;
```

---

### `qs_priority_history`

**Quarter-section rollup time series.** Append when QS priority rollups change during sync.

Partitioned by `DATE(recorded_at)`, clustered by `qs_id`.

| Column | Meaning |
| ------ | ------- |
| `qs_id` | Quarter section id (join to `quarter_sections`, `qs_priority`) |
| `sync_run_id` | Which sync produced this snapshot |
| `recorded_at` | X-axis time |
| `PS_critical`, `PS_bottom90`, `n`, `PS_background`, `PS_composite` | Rollup components |
| `Priority_Score_Normalized` | **Primary line to plot for QS maps over time** |
| `ps_global`, `k`, `critical_weight` | May be null until loader populates them |

**Example — QS score trend**

```sql
SELECT recorded_at, Priority_Score_Normalized, PS_composite, n
FROM `mke-trees.mke_tree_dataset.qs_priority_history`
WHERE qs_id = @qs_id
ORDER BY recorded_at;
```

**Example — top QS movers between two syncs** (once ≥2 runs exist)

```sql
WITH ranked AS (
  SELECT
    qs_id,
    sync_run_id,
    recorded_at,
    Priority_Score_Normalized,
    LAG(Priority_Score_Normalized) OVER (PARTITION BY qs_id ORDER BY recorded_at) AS prev_score
  FROM `mke-trees.mke_tree_dataset.qs_priority_history`
)
SELECT qs_id, recorded_at, prev_score, Priority_Score_Normalized,
       Priority_Score_Normalized - prev_score AS delta
FROM ranked
WHERE prev_score IS NOT NULL
ORDER BY ABS(Priority_Score_Normalized - prev_score) DESC
LIMIT 20;
```

---

## 5. Recommended graph views

| View | Table(s) | Y-axis | X-axis / group |
| ---- | -------- | ------ | -------------- |
| Tree PS over time | `trees_snapshot_history` | `priority_score` | `recorded_at` |
| Tree PS components | `trees_snapshot_history` | `s_f`, `I_f`, `p_f`, `a_p` | `recorded_at` (multi-series) |
| DBH / height / condition trends | `trees_snapshot_history` | `dbh`, `height`, `condition` | `recorded_at` |
| QS rollup over time | `qs_priority_history` | `Priority_Score_Normalized` | `recorded_at` |
| Sync activity dashboard | `sync_runs` | bar: `trees_changed`, `qs_updated` | `started_at` |
| Live map (no history) | `trees_core` + `trees_features` + `qs_priority` | color by `priority_score` or QS normalized | map geometry from `quarter_sections` |

**UX note:** Label charts “Updated on sync” rather than “daily” — data points arrive weekly (or when an operator runs the sync).

---

## 6. Keys and cardinality

| Relationship | Cardinality | Join |
| ------------ | ----------- | ---- |
| `trees_core` ↔ `trees_features` | 1:1 | `tree_id` |
| `trees_core` → `quarter_sections` | N:1 | `trees_core.qs_id = quarter_sections.qs_id` |
| `quarter_sections` ↔ `qs_priority` | 1:1 | `qs_id` |
| `sync_runs` → `trees_snapshot_history` | 1:N | `sync_run_id` |
| `sync_runs` → `qs_priority_history` | 1:N | `sync_run_id` |
| `trees_core` → `trees_snapshot_history` | 1:N over time | `tree_id` or `site_id` (prefer `site_id` for user input) |

**MERGE rules (why live vs history differ):**

- Operational `trees_core` merges on **`site_id`** (TreeKeeper inventory key).
- History only appends for **changed/new** sites (~26k rows on first run), not all ~206k trees.
- Unchanged trees: read live PS from `trees_features`; no history row until a future sync detects a change.

---

## 7. What the first sync changed (context)

Run `tk-2026-06-14T194107Z` approximate counts:

| Metric | Count |
| ------ | ----: |
| Trees unchanged | 179,388 |
| Trees merged (field changes) | 11,990 |
| New in TreeKeeper | 14,669 |
| Missing from TreeKeeper | 85 |
| PS recomputed | 13,161 |
| QS rollups updated | 369 |
| Rows in `trees_snapshot_history` | ~26,659 |
| Rows in `qs_priority_history` | 369 |

Operational MERGE updated **`trees_core`**, **`trees_features`**, and **`qs_priority`** for those deltas; history tables preserve the same events for analytics.

---

## 8. API / query tips

1. **Filter history queries by date** using `recorded_at` or `DATE(recorded_at)` to leverage partitioning.
2. **Always restrict `sync_runs.status = 'success'`** when driving user-visible timelines.
3. For tree lookup by user-entered id, use **`site_id`**, not `tree_id`.
4. Live dashboard: query operational tables only (faster, single row per tree).
5. Trend dashboard: query history tables; expect sparse series until multiple syncs exist.
6. Null `priority_score` in history usually means the site had inventory changes but PS was not recomputed (zero-guard-only deltas) or status excludes live trees.

---

## 9. Baseline vs first sync (two-point graphs)

This is the main edge case after the **first** TreeKeeper sync.

### What the frontend is seeing

Querying only `trees_snapshot_history` returns **one timestamp** (`2026-06-14`) for every row. That is expected: only one sync has run so far.

The **~5-month-old inventory** is **not** stored as a separate history row with an old `recorded_at`. It lives elsewhere (below).

### Where the “5 months ago” data actually is

| What | Where | In BQ? | Use for |
| ---- | ----- | ------ | ------- |
| Full stale inventory (~191k sites) | `data/raw/full_valid_trees.csv` | No | Baseline inventory fields |
| Frozen copy from sync run | `treekeeper_sync/runs/tk-2026-06-14T194107Z/baseline/inventory.csv` | No | Same baseline, audit-safe |
| PS + components before sync | `treekeeper_sync/runs/tk-2026-06-14T194107Z/pre_ps/priority_score_components.csv` | No | Baseline `priority_score`, `S_f`, … |
| Live PS file (pre-sync copy) | `data/priority_score/priority_score_components.csv` | Partially mirrored in legacy load | Baseline PS for all trees |
| Pre-merge snapshot for **changed** sites only | `trees_snapshot_history` columns (`dbh`, `height`, `priority_score`, …) | **Yes** — but `recorded_at` is still **Jun 14** | “Before” values for ~26k changed/new sites |
| Post-sync current state | `trees_core` + `trees_features` | **Yes** | “After” values (Jun 14 MERGE) |
| Post-sync merged inventory (file) | `treekeeper_sync/runs/.../merged/full_valid_trees.csv` | No | After inventory |
| Post-sync PS for recomputed trees | `treekeeper_sync/runs/.../ps/updated_tree_rows.csv` | No (also in `trees_features`) | After PS |

**Run manifest** (paths + counts): `treekeeper_sync/runs/tk-2026-06-14T194107Z/manifest.json`

### How v1 history rows are built

For each **changed or new** site, the sync writes one history row where:

- `dbh`, `height`, `crown_width`, `condition`, `damage` → from **baseline** (`full_valid_trees.csv` before merge)
- `priority_score`, `s_f`, `I_f`, `p_f`, `a_p` → from **pre-sync** `priority_score_components.csv`
- `recorded_at` → **sync time** (Jun 14), not baseline age

Local jsonl includes `"phase": "pre_merge"`; BQ does not store `phase`.

### Recommended two-point chart (first sync only)

Synthesize **two points** for changed trees:

| Point | Label | Timestamp (x-axis) | Data source |
| ----- | ----- | ------------------ | ----------- |
| **A — Baseline** | “Last loaded inventory” | Fixed constant, e.g. `2026-01-01`, or baseline file date / max `Inventory Date` — **not in BQ today** | `trees_snapshot_history` **or** join baseline CSV via API |
| **B — After sync** | “TreeKeeper sync” | `sync_runs.started_at` for `tk-2026-06-14T194107Z`, or `trees_core.updated_at` | `trees_core` + `trees_features` |

**Example — two-point PS for one changed site (BQ only)**

```sql
-- Point B: after sync (operational)
SELECT
  c.site_id,
  c.updated_at AS recorded_at,
  'post_sync' AS phase,
  f.priority_score,
  c.dbh,
  c.condition
FROM `mke-trees.mke_tree_dataset.trees_core` c
JOIN `mke-trees.mke_tree_dataset.trees_features` f USING (tree_id)
WHERE c.site_id = @site_id

UNION ALL

-- Point A: baseline (from history row; use synthetic date on the client)
SELECT
  h.site_id,
  TIMESTAMP('2026-01-01') AS recorded_at,  -- synthetic — replace with product constant
  'baseline' AS phase,
  h.priority_score,
  h.dbh,
  h.condition
FROM `mke-trees.mke_tree_dataset.trees_snapshot_history` h
WHERE h.site_id = @site_id
  AND h.sync_run_id = 'tk-2026-06-14T194107Z';
```

**Trees with no history row (~179k unchanged):** operational tables were **not** updated on Jun 14. For those sites, baseline ≈ current — show a **single point** or “No change since last inventory load” (do not expect two BQ history points).

**New-in-TK sites (~14k):** history row exists but baseline inventory fields are empty; only post-sync operational data is meaningful.

### QS rollup graphs (same pattern)

| Point | Source |
| ----- | ------ |
| Baseline QS | `qs_priority` unchanged rows **or** infer from pre-sync; changed QS also in `pre_ps/priority_score_components.csv` / run backup — **not** a separate dated BQ history row before Jun 14 |
| After sync | `qs_priority` (operational) or `qs_priority_history` with `recorded_at = 2026-06-14` |

Only **369** quarter sections had rollup changes; the rest are unchanged single-point.

### After the second weekly sync

Once two `sync_run_id` values exist in `trees_snapshot_history`, use real `recorded_at` values only — no synthetic baseline date needed.

---

## 10. Related files

| File | Purpose |
| ---- | ------- |
| [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) | Full DDL, ERD, migration notes |
| [`treekeeper_sync/README.md`](../treekeeper_sync/README.md) | How weekly sync is run |
| `treekeeper_sync/runs/<sync_run_id>/deltas/merge_report.json` | Per-site field-level change audit (not in BQ) |
