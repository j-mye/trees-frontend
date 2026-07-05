import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Map, { Layer, NavigationControl, Popup, Source } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'
import { useTreeShapExplanation } from '../hooks/useTreeShapExplanation.js'
import { shapSiteIdFromTree } from '../utils/shapLookup.js'
import AppNavbar from '../components/AppNavbar.jsx'
import { PriorityTuningPanel } from '../components/map/PriorityTuningPanel.jsx'
import { InventoryInsightPanel } from '../components/inventory/InventoryInsightPanel.jsx'
import {
  averageLastPrunedFromTrees,
  avgLastPrunedFromSummaryProperties,
  formatAvgLastPruned,
} from '../utils/inventoryStats.js'
import {
  applyPriorityTuningToGeojson,
  computePriorityFactorBreakdown,
  DEFAULT_PRIORITY_TUNING,
  enrichPruneQueueRowsWithPsMetrics,
  formatPsComposite,
} from '../utils/priorityModel.js'
import {
  buildDiscreteQsFillExpression,
  buildQsLabelPoints,
  buildQsScoreTreeMinVisibilityFilter,
  colorFromScore,
  computeQsScoreBinBounds,
  DEFAULT_MAP_STYLE,
  enrichQsGeojsonWithMapLevel,
  featureMatchesScoreTreeMinFilters,
  featureQsHasTrees,
  geojsonWithMapGeometryOnly,
  qsLinePaint,
} from '../map/riskLayers.js'

/**
 * @typedef {object} TreePriorityRow
 * @property {string} tree_id
 * @property {number} priority_score
 * @property {number | null} [i_f]
 * @property {number | null} [p_f]
 * @property {number | null} [a_p]
 * @property {number} age
 * @property {number} maintenance_deficit
 * @property {number} years_since_pruned
 * @property {boolean} can_strike_building
 * @property {number} crown_diameter_m
 * @property {string} condition_aerial
 * @property {string} missing_or_dead
 * @property {number} lat
 * @property {number} lon
 * @property {number} dbh
 * @property {number | null | undefined} height
 * @property {string} species
 */

const DEFAULT_CENTER = [43.0389, -87.9065]
const DEFAULT_ZOOM = 12
const STAT_CARD_CLASS = 'bg-slate-50 p-3 rounded-xl border border-slate-100'
const STAT_LABEL_CLASS = 'text-[10px] font-bold text-slate-400 uppercase mb-1'
const STAT_VALUE_CLASS = 'text-xl font-black text-slate-700'
/** Bumped when getTreesByQs tree row shape changes (avoids stale session cache without height). */
const QS_TREES_CLIENT_CACHE_TAG = 'v7-site-id'
/** Bumped when summaries GeoJSON properties change (avoids stale browser HTTP cache). */
const SUMMARIES_CLIENT_CACHE_TAG = 'v3-priority-factors'
const PRUNE_QUEUE_METRICS_BACKFILL_LIMIT = 40

const PRUNE_QUEUE_PRIORITY_ORDER = /** @type {const} */ ({
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
})

/** @typedef {'qsId' | 'psComposite' | 'priorityLevel' | 'district' | 'treeCount' | 'topSpecies' | 'avgLastPruned'} PruneQueueSortKey */

/**
 * @param {object} row
 * @param {PruneQueueSortKey} key
 * @returns {number | string | null}
 */
function pruneQueueSortValue(row, key) {
  switch (key) {
    case 'qsId':
      return row.qsId
    case 'psComposite':
      return row.psComposite
    case 'priorityLevel':
      return PRUNE_QUEUE_PRIORITY_ORDER[row.relativeLevel ?? row.priorityLevel] ?? 0
    case 'district':
      return row.district
    case 'treeCount':
      return row.treeCount
    case 'topSpecies':
      return row.topSpecies
    case 'avgLastPruned':
      return row.avgLastPruned
    default:
      return null
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {PruneQueueSortKey} key
 * @param {'asc' | 'desc'} direction
 */
function sortPruneQueueRows(rows, key, direction) {
  const dir = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = pruneQueueSortValue(a, key)
    const bv = pruneQueueSortValue(b, key)
    if (av == null && bv == null) return a.qsId.localeCompare(b.qsId) * dir
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return (av - bv) * dir
      return a.qsId.localeCompare(b.qsId) * dir
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    if (cmp !== 0) return cmp * dir
    return a.qsId.localeCompare(b.qsId) * dir
  })
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {PruneQueueSortKey} props.columnKey
 * @param {PruneQueueSortKey} props.activeKey
 * @param {'asc' | 'desc'} props.direction
 * @param {(key: PruneQueueSortKey) => void} props.onSort
 * @param {string} [props.className]
 */
function PruneQueueSortHeader({ label, columnKey, activeKey, direction, onSort, className = '' }) {
  const active = activeKey === columnKey
  const alignRight = className.includes('text-right')
  return (
    <th className={className}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 transition-colors hover:text-slate-800 ${
          alignRight ? 'ml-auto' : ''
        } ${active ? 'text-indigo-700' : ''}`}
        onClick={() => onSort(columnKey)}
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span className="text-[9px] opacity-70" aria-hidden>
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

const QS_SOURCE_ID = 'qs-source'
const QS_FILL_LAYER_ID = 'qs-fill-layer'
const QS_LINE_LAYER_ID = 'qs-line-layer'
const QS_LABEL_SOURCE_ID = 'qs-label-source'
const QS_LABEL_LAYER_ID = 'qs-label-layer'
const TREE_SOURCE_ID = 'tree-source'
const TREE_LAYER_ID = 'tree-layer'
/** Stable empty GeoJSON so QS layers stay mounted and paint below trees when data reloads. */
const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] }

/** Session cache for score bin bounds; invalidated by URL or user id mismatch (see read/write helpers). */
const QS_SCORE_BOUNDS_STORAGE_KEY = 'trees_qs_fill_bounds_v1'

/** Fixed district filter values (must match quarter-section GeoJSON `district` strings). */
const DISTRICT_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'North', label: 'North' },
  { value: 'Central', label: 'Central' },
  { value: 'South', label: 'South' },
  { value: 'Unknown', label: 'Unknown' },
]

/**
 * @param {string} summariesUrl
 * @param {string | null | undefined} userId
 * @returns {{ min: number, max: number } | null}
 */
function readQsScoreBoundsCache(summariesUrl, userId) {
  if (!summariesUrl?.trim() || !userId) return null
  try {
    const raw = sessionStorage.getItem(QS_SCORE_BOUNDS_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (o.summariesUrl !== summariesUrl) return null
    if (o.uid !== userId) return null
    const min = Number(o.min)
    const max = Number(o.max)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null
    return { min, max }
  } catch {
    return null
  }
}

/** Quarter-section id for API + joins: BigQuery/geojson vs GIS (QTRSEC). */
function qsIdFromFeatureProperties(properties) {
  if (!properties) return null
  if (properties.qs_id != null && String(properties.qs_id).trim() !== '') {
    return String(properties.qs_id).trim()
  }
  if (properties.quarter_section != null && String(properties.quarter_section).trim() !== '') {
    return String(properties.quarter_section).trim()
  }
  if (properties.QTRSEC != null && String(properties.QTRSEC).trim() !== '') {
    return String(properties.QTRSEC).trim()
  }
  return null
}

/**
 * Height (feet) from API rows or MapLibre GeoJSON feature properties.
 * @param {Record<string, unknown> | TreePriorityRow | null | undefined} row
 * @returns {number | null}
 */
function treesHeightFtFromRecord(row) {
  if (!row || typeof row !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (row)
  const raw = r.height ?? r.Height ?? r.tree_height ?? r.Tree_Height
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function treeIdFromRecord(row) {
  if (!row || typeof row !== 'object') return ''
  const r = /** @type {Record<string, unknown>} */ (row)
  const raw = r.tree_id ?? r.tree_row_id
  if (raw == null) return ''
  return String(raw).trim()
}

function getTreeFillColor(condition) {
  if (condition == null || condition === '') return '#22c55e'
  const raw = String(condition).trim()
  const n = Number(raw)
  if (Number.isFinite(n) && raw !== '') {
    if (n <= 1) return '#22c55e'
    if (n === 2) return '#84cc16'
    if (n === 3) return '#eab308'
    if (n === 4) return '#f97316'
    return '#ef4444'
  }
  const s = raw.toLowerCase()
  if (s.includes('excellent') || s.includes('good') || s.includes('fair')) return '#22c55e'
  if (s.includes('poor')) return '#f97316'
  if (s.includes('dead') || s.includes('remove') || s.includes('critical')) return '#ef4444'
  return '#22c55e'
}

function parseCloudFunctionError(defaultMessage, error, fallbackBody = '') {
  const suffix = fallbackBody ? `: ${fallbackBody.slice(0, 220)}` : ''
  if (error instanceof Error) return `${defaultMessage}: ${error.message}`
  return `${defaultMessage}${suffix}`
}

/** Badge styles for QS `priority_level` (aligned with map thresholds). */
function priorityLevelBadgeClass(level) {
  const l = String(level ?? '').trim().toLowerCase()
  if (l === 'critical') return 'border border-red-200 bg-red-100 text-red-900'
  if (l === 'high') return 'border border-orange-200 bg-orange-100 text-orange-950'
  if (l === 'medium') return 'border border-amber-200 bg-amber-100 text-amber-950'
  return 'border border-slate-200 bg-slate-100 text-slate-800'
}

export default function MapDashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [summary, setSummary] = useState(null)
  const [geojson, setGeojson] = useState(null)
  const [selectedQs, setSelectedQs] = useState(null)
  const [selectedTrees, setSelectedTrees] = useState(/** @type {TreePriorityRow[]} */ ([]))
  const [isLoadingTrees, setIsLoadingTrees] = useState(false)
  const [treeFetchError, setTreeFetchError] = useState('')
  const treesCacheRef = useRef({})
  const [panelOpen, setPanelOpen] = useState(true)
  const [qsDetailsExpanded, setQsDetailsExpanded] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showTrees, setShowTrees] = useState(true)
  const [psMin, setPsMin] = useState(0)
  const [psMax, setPsMax] = useState(Number.MAX_SAFE_INTEGER)
  const psFilterInitializedRef = useRef(false)
  const [treeMin, setTreeMin] = useState(0)
  const [district, setDistrict] = useState('all')
  const [treePopup, setTreePopup] = useState(null)
  /** Site / tree id for SHAP explanation in the QS details card. */
  const [focusedTreeSiteId, setFocusedTreeSiteId] = useState(/** @type {string | null} */ (null))
  /** Inventory: map vs ranked pruning-priority list (same data as map summaries / `qs_priority`). */
  const [inventoryView, setInventoryView] = useState(/** @type {'map' | 'prune-queue'} */ ('map'))
  const [pruneQueueSort, setPruneQueueSort] = useState(
    /** @type {{ key: PruneQueueSortKey, direction: 'asc' | 'desc' }} */ ({
      key: 'psComposite',
      direction: 'desc',
    }),
  )
  const [pruneQueueAvgLastPrunedByQsId, setPruneQueueAvgLastPrunedByQsId] = useState(
    /** @type {Record<string, number>} */ ({}),
  )
  const [priorityTuning, setPriorityTuning] = useState(() => ({ ...DEFAULT_PRIORITY_TUNING }))
  const pruneQueueBackfillRef = useRef(new Set())
  const mapRef = useRef(null)

  const summariesUrl = mapApiEnv.summariesUrl
  const treesUrl = mapApiEnv.treesUrl
  const shapExplanationUrl = mapApiEnv.shapExplanationUrl

  const queryClient = useQueryClient()

  const focusedTree = useMemo(() => {
    if (!focusedTreeSiteId) return null
    return (
      selectedTrees.find((t) => treeIdFromRecord(t) === focusedTreeSiteId) ?? null
    )
  }, [selectedTrees, focusedTreeSiteId])

  const shapExplanationQuery = useTreeShapExplanation({
    siteId: focusedTree ? shapSiteIdFromTree(focusedTree) : null,
    shapExplanationUrl,
  })

  /** Mean DBH from loaded trees when available; otherwise GeoJSON `avg_dbh` while loading or when tree list is empty. */
  const displayAverageDbh = useMemo(() => {
    if (!selectedQs) return null
    const fromGeo = Number(selectedQs.avg_dbh)
    const geoOk = Number.isFinite(fromGeo)
    if (!isLoadingTrees) {
      if (selectedTrees.length > 0) {
        const nums = selectedTrees
          .map((t) => Number(t.dbh))
          .filter((n) => Number.isFinite(n) && n >= 0)
        if (nums.length > 0) return nums.reduce((a, b) => a + b, 0) / nums.length
      }
      if (geoOk) return fromGeo
      return null
    }
    if (geoOk) return fromGeo
    return null
  }, [selectedQs, selectedTrees, isLoadingTrees])

  /** Drop cached SHAP / priority explanation when no tree is focused (QS still open). */
  useEffect(() => {
    if (!focusedTreeSiteId) {
      queryClient.removeQueries({ queryKey: ['treeShapExplanation'] })
    }
  }, [focusedTreeSiteId, queryClient])

  useEffect(() => {
    let cancelled = false
    async function loadQuarterSectionSummaries() {
      if (!summariesUrl.trim()) {
        setError('VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL is not set in frontend/.env.')
        setLoading(false)
        return
      }
      if (authLoading) return
      if (!user) {
        setError('Sign in required.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const token = await user.getIdToken()
        const summariesSep = summariesUrl.includes('?') ? '&' : '?'
        const summariesFetchUrl = `${summariesUrl}${summariesSep}schema=${encodeURIComponent(SUMMARIES_CLIENT_CACHE_TAG)}`
        const res = await fetch(summariesFetchUrl, {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        })
        const text = await res.text()
        let json = null
        try {
          json = text ? JSON.parse(text) : null
        } catch {
          throw new Error(`Expected JSON; got HTTP ${res.status}: ${text.slice(0, 220)}`)
        }
        if (!res.ok) {
          throw new Error(
            typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`
          )
        }
        if (!json?.summary || !json?.geojson) {
          throw new Error('Response missing summary/geojson fields.')
        }
        if (!cancelled) {
          setSummary(json.summary)
          setGeojson(json.geojson)
          treesCacheRef.current = {}
          setSelectedQs(null)
          setFocusedTreeSiteId(null)
          setTreePopup(null)
          setSelectedTrees([])
          setTreeFetchError('')
          setPruneQueueAvgLastPrunedByQsId({})
          pruneQueueBackfillRef.current = new Set()
        }
      } catch (err) {
        if (!cancelled) {
          setError(parseCloudFunctionError('Failed loading quarter section summaries', err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadQuarterSectionSummaries()
    return () => {
      cancelled = true
    }
  }, [authLoading, summariesUrl, user])

  /** GeoJSON with `_map_level` for consistent priority labeling on features. */
  const qsMapGeojson = useMemo(() => enrichQsGeojsonWithMapLevel(geojson), [geojson])

  const tunedQsMapGeojson = useMemo(
    () => applyPriorityTuningToGeojson(qsMapGeojson, priorityTuning),
    [qsMapGeojson, priorityTuning],
  )

  /** Map polygons only — excludes qs_priority rows with no quarter_sections geometry. */
  const tunedQsMapGeojsonForMap = useMemo(
    () => geojsonWithMapGeometryOnly(tunedQsMapGeojson),
    [tunedQsMapGeojson],
  )

  const psFilterBounds = useMemo(() => {
    if (!Array.isArray(tunedQsMapGeojson?.features) || tunedQsMapGeojson.features.length === 0) {
      return { min: 0, max: 1, step: 0.01 }
    }
    const bounds = computeQsScoreBinBounds(tunedQsMapGeojson, { usePercentile: false })
    const min = Number.isFinite(bounds.min) ? bounds.min : 0
    const max = Number.isFinite(bounds.max) && bounds.max > min ? bounds.max : min + 1
    const span = max - min
    const step = span < 1 ? 0.001 : span < 10 ? 0.01 : 0.1
    return { min, max, step }
  }, [tunedQsMapGeojson])

  useEffect(() => {
    if (!Array.isArray(tunedQsMapGeojson?.features) || tunedQsMapGeojson.features.length === 0) return
    if (psFilterInitializedRef.current) return
    setPsMin(psFilterBounds.min)
    setPsMax(psFilterBounds.max)
    psFilterInitializedRef.current = true
  }, [tunedQsMapGeojson, psFilterBounds.min, psFilterBounds.max])

  const mapControlFilterState = useMemo(
    () => ({ psMin, psMax, treeMin, district }),
    [district, psMax, psMin, treeMin]
  )

  const priorityFactorBreakdown = useMemo(
    () =>
      computePriorityFactorBreakdown(
        tunedQsMapGeojson?.features ?? [],
        (f) => featureMatchesScoreTreeMinFilters(f, mapControlFilterState),
        priorityTuning,
      ),
    [tunedQsMapGeojson, mapControlFilterState, priorityTuning],
  )

  useEffect(() => {
    if (!Array.isArray(geojson?.features)) return
    /** @type {Record<string, number>} */
    const fromSummaries = {}
    for (const f of geojson.features) {
      const p = f.properties || {}
      const qsId = qsIdFromFeatureProperties(p)
      const avg = avgLastPrunedFromSummaryProperties(p)
      if (qsId && avg != null) fromSummaries[qsId] = avg
    }
    if (Object.keys(fromSummaries).length === 0) return
    setPruneQueueAvgLastPrunedByQsId((prev) => ({ ...prev, ...fromSummaries }))
  }, [geojson])

  /**
   * Bounds for 15 discrete fill bins from loaded GeoJSON (see `computeQsScoreBinBounds` in riskLayers).
   * Until `geojson` arrives, same-tab session cache can hydrate min/max for faster repeat visits.
   */
  const scoreBounds = useMemo(() => {
    if (Array.isArray(tunedQsMapGeojson?.features) && tunedQsMapGeojson.features.length > 0) {
      return computeQsScoreBinBounds(tunedQsMapGeojson, {
        usePercentile: priorityTuning.usePercentileColors,
        lowPct: priorityTuning.colorPercentileLow,
        highPct: priorityTuning.colorPercentileHigh,
      })
    }
    const cached = readQsScoreBoundsCache(summariesUrl, user?.uid)
    if (cached) return cached
    return { min: 0, max: 100 }
  }, [tunedQsMapGeojson, priorityTuning, summariesUrl, user?.uid])

  useEffect(() => {
    if (!Array.isArray(tunedQsMapGeojson?.features) || tunedQsMapGeojson.features.length === 0) return
    if (!summariesUrl?.trim() || !user?.uid) return
    const b = computeQsScoreBinBounds(tunedQsMapGeojson, {
      usePercentile: priorityTuning.usePercentileColors,
      lowPct: priorityTuning.colorPercentileLow,
      highPct: priorityTuning.colorPercentileHigh,
    })
    try {
      sessionStorage.setItem(
        QS_SCORE_BOUNDS_STORAGE_KEY,
        JSON.stringify({
          min: b.min,
          max: b.max,
          featureCount: tunedQsMapGeojson.features.length,
          summariesUrl,
          uid: user.uid,
          savedAt: Date.now(),
        })
      )
    } catch {
      /* ignore quota / private mode */
    }
  }, [tunedQsMapGeojson, priorityTuning, summariesUrl, user?.uid])

  const qsMapLayerFilter = useMemo(
    () =>
      buildQsScoreTreeMinVisibilityFilter({
        psMin,
        psMax,
        treeMin,
        district,
      }),
    [district, psMax, psMin, treeMin]
  )

  /** Overview: all qs_priority rows returned by summaries (not limited to map-visible filters). */
  const overviewQsStatistics = useMemo(() => {
    const features = Array.isArray(tunedQsMapGeojson?.features) ? tunedQsMapGeojson.features : []
    let totalTrees = 0
    for (const f of features) {
      const p = f.properties || {}
      totalTrees += Number(p.tree_count ?? p.total_trees ?? 0) || 0
    }
    return {
      total_quarter_sections: features.length,
      total_trees: totalTrees,
    }
  }, [tunedQsMapGeojson])

  const displayStatistics = useMemo(() => {
    if (!summary?.statistics) return null
    if (!Array.isArray(qsMapGeojson?.features)) return summary.statistics
    return {
      ...summary.statistics,
      total_quarter_sections: overviewQsStatistics.total_quarter_sections,
      total_trees: overviewQsStatistics.total_trees,
    }
  }, [summary, qsMapGeojson, overviewQsStatistics])

  /** All qs_priority rows for the pruning list (map sidebar filters do not apply here). */
  const pruningPriorityRows = useMemo(() => {
    const features = Array.isArray(tunedQsMapGeojson?.features) ? tunedQsMapGeojson.features : []
    const rows = []
    for (const f of features) {
      const p = f.properties || {}
      const qsId = qsIdFromFeatureProperties(p)
      if (!qsId) continue
      const psComposite = Number(p._psCompositeDisplay ?? p.PS_composite) || 0
      const trees = Number(p.tree_count ?? p.total_trees ?? 0) || 0
      const avgFromSummary = avgLastPrunedFromSummaryProperties(p)
      rows.push({
        qsId,
        psComposite,
        priorityLevel: String(p.priority_level ?? p._map_level ?? '').trim() || 'Low',
        district: String(p.district ?? 'Unknown'),
        treeCount: trees,
        topSpecies: String(p.top_species ?? 'Unknown'),
        avgLastPruned: avgFromSummary ?? pruneQueueAvgLastPrunedByQsId[qsId] ?? null,
        centerLat: p.center_lat != null ? Number(p.center_lat) : null,
        centerLon: p.center_lon != null ? Number(p.center_lon) : null,
        hasMapGeometry: Boolean(p.has_map_geometry),
        properties: p,
      })
    }
    return enrichPruneQueueRowsWithPsMetrics(rows)
  }, [tunedQsMapGeojson, pruneQueueAvgLastPrunedByQsId, priorityTuning])

  const sortedPruningPriorityRows = useMemo(
    () => sortPruneQueueRows(pruningPriorityRows, pruneQueueSort.key, pruneQueueSort.direction),
    [pruningPriorityRows, pruneQueueSort],
  )

  const handlePruneQueueSort = (key) => {
    setPruneQueueSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      const defaultDesc = key === 'psComposite' || key === 'treeCount' || key === 'avgLastPruned'
      return { key, direction: defaultDesc ? 'desc' : 'asc' }
    })
  }

  const sidebarWidthPx = panelOpen ? 360 : 56

  const loadFinishedOk = useMemo(
    () => !loading && !error && geojson != null && summary != null,
    [loading, error, geojson, summary]
  )

  const noPolygonFeatures = useMemo(
    () => loadFinishedOk && Array.isArray(geojson.features) && geojson.features.length === 0,
    [loadFinishedOk, geojson]
  )

  const noQsWithTreesOnMap = useMemo(() => {
    if (!loadFinishedOk || !qsMapGeojson?.features?.length) return false
    return !qsMapGeojson.features.some((f) => featureQsHasTrees(f))
  }, [loadFinishedOk, qsMapGeojson])

  const noQsMatchScoreTreeFilters = useMemo(() => {
    if (!loadFinishedOk || !qsMapGeojson?.features?.length) return false
    if (!qsMapGeojson.features.some((f) => featureQsHasTrees(f))) return false
    return !qsMapGeojson.features.some((f) => featureMatchesScoreTreeMinFilters(f, mapControlFilterState))
  }, [loadFinishedOk, qsMapGeojson, mapControlFilterState])

  const mapCenter = useMemo(() => {
    if (summary?.bounds?.center_lat != null && summary?.bounds?.center_lon != null) {
      return [summary.bounds.center_lat, summary.bounds.center_lon]
    }
    return DEFAULT_CENTER
  }, [summary])

  const qsLabelGeojson = useMemo(
    () => buildQsLabelPoints(tunedQsMapGeojsonForMap ?? { type: 'FeatureCollection', features: [] }),
    [tunedQsMapGeojsonForMap]
  )

  const treeGeojson = useMemo(() => {
    const features =
      showTrees && Array.isArray(selectedTrees)
        ? selectedTrees
            .map((tree, i) => {
              const lat = Number(tree?.lat)
              const lon = Number(tree?.lon)
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
              return {
                type: 'Feature',
                id: treeIdFromRecord(tree) || i,
                properties: {
                  tree_id: treeIdFromRecord(tree),
                  priority_score: Number(tree?.priority_score || 0),
                  species: tree?.species || 'N/A',
                  dbh: Number(tree?.dbh || 0),
                  height: treesHeightFtFromRecord(tree),
                  condition: tree?.condition || 'N/A',
                  marker_color: getTreeFillColor(tree?.condition),
                },
                geometry: {
                  type: 'Point',
                  coordinates: [lon, lat],
                },
              }
            })
            .filter(Boolean)
        : []
    return { type: 'FeatureCollection', features }
  }, [selectedTrees, showTrees])

  const qsFillLayer = useMemo(
    () => ({
      id: QS_FILL_LAYER_ID,
      type: 'fill',
      source: QS_SOURCE_ID,
      paint: {
        'fill-color': buildDiscreteQsFillExpression(scoreBounds.min, scoreBounds.max),
        'fill-opacity': 0.7,
      },
    }),
    [scoreBounds.min, scoreBounds.max]
  )

  const qsLineLayer = useMemo(
    () => ({
      id: QS_LINE_LAYER_ID,
      type: 'line',
      source: QS_SOURCE_ID,
      paint: qsLinePaint,
    }),
    []
  )

  const qsLabelLayer = useMemo(
    () => ({
      id: QS_LABEL_LAYER_ID,
      type: 'symbol',
      source: QS_LABEL_SOURCE_ID,
      minzoom: 11,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11, 8,
          14, 14,
          18, 22,
        ],
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 6,
        'text-halo-blur': 0.8,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11, 0,
          11.5, 1,
        ],
      },
    }),
    []
  )

  const treeLayer = useMemo(
    () => ({
      id: TREE_LAYER_ID,
      type: 'circle',
      source: TREE_SOURCE_ID,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          1.5,
          16,
          5,
          20,
          10,
        ],
        'circle-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'priority_score'], 0],
          0,
          '#94a3b8',
          50,
          '#38bdf8',
          100,
          '#fb923c',
        ],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0f172a',
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'priority_score'], 0],
          0,
          0.4,
          80,
          1.0,
        ],
      },
    }),
    []
  )

  /** Ensure tree layer paints above QS fills (and style reorder edge cases). */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const ref = mapRef.current
      if (!ref) return
      const map = typeof ref.getMap === 'function' ? ref.getMap() : null
      if (!map?.getLayer?.(TREE_LAYER_ID)) return
      map.moveLayer(TREE_LAYER_ID)
    })
    return () => cancelAnimationFrame(frame)
  }, [treeGeojson, qsMapGeojson, qsLabelGeojson])

  useEffect(() => {
    const b = summary?.bounds
    if (!mapRef.current || !b) return
    if (
      b.min_lon == null ||
      b.min_lat == null ||
      b.max_lon == null ||
      b.max_lat == null
    ) {
      return
    }
    mapRef.current.fitBounds(
      [
        [b.min_lon, b.min_lat],
        [b.max_lon, b.max_lat],
      ],
      { padding: 40, duration: 0 }
    )
  }, [summary])

  function onMapClick(event) {
    const features = Array.isArray(event?.features) ? event.features : []
    if (features.length === 0) {
      setFocusedTreeSiteId(null)
      setTreePopup(null)
      return
    }
    const feature = features[0]
    const layerId = feature?.layer?.id
    if (layerId === QS_FILL_LAYER_ID) {
      const props = feature?.properties || {}
      const qsId = qsIdFromFeatureProperties(props)
      const currentId = selectedQs ? qsIdFromFeatureProperties(selectedQs) : null
      if (qsId && currentId && qsId === currentId) {
        return
      }
      const selected = {
        ...props,
        qs_id: qsId,
      }
      setFocusedTreeSiteId(null)
      setSelectedQs(selected)
      setQsDetailsExpanded(true)
      setTreePopup(null)
      if (qsId) void fetchTreesForQs(qsId)
      return
    }
    if (layerId === TREE_LAYER_ID) {
      const [lon, lat] = feature?.geometry?.coordinates || []
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
      const props = feature?.properties || {}
      const rowId = props.tree_id != null && String(props.tree_id).trim() !== ''
        ? String(props.tree_id).trim()
        : null
      if (rowId) {
        setFocusedTreeSiteId(rowId)
      }
      setTreePopup({
        latitude: lat,
        longitude: lon,
        tree: {
          tree_id: props.tree_id,
          priority_score: Number(props.priority_score || 0),
          species: props.species,
          dbh: Number(props.dbh || 0),
          height: treesHeightFtFromRecord(props),
          condition: props.condition,
        },
      })
    }
  }

  function focusQsFromPruningQueue(row) {
    if (!row?.qsId) return
    setInventoryView('map')
    const selected = { ...row.properties, qs_id: row.qsId }
    setFocusedTreeSiteId(null)
    setSelectedQs(selected)
    setQsDetailsExpanded(true)
    setTreePopup(null)
    void fetchTreesForQs(row.qsId)
    const lat = row.centerLat
    const lon = row.centerLon
    requestAnimationFrame(() => {
      const ref = mapRef.current
      const map = ref && typeof ref.getMap === 'function' ? ref.getMap() : null
      if (map && Number.isFinite(lat) && Number.isFinite(lon)) {
        map.flyTo({ center: [lon, lat], zoom: 15, duration: 1000 })
      }
    })
  }

  async function fetchTreesForQsData(qs_id) {
    if (!qs_id) return []

    const cacheKey = `${qs_id}\t${QS_TREES_CLIENT_CACHE_TAG}`
    const cached = treesCacheRef.current[cacheKey]
    if (cached) return cached

    if (!treesUrl.trim()) {
      throw new Error('VITE_CF_GET_TREES_BY_QS_URL is not set in frontend/.env.')
    }
    if (!user) {
      throw new Error('Sign in required.')
    }

    const token = await user.getIdToken()
    const sep = treesUrl.includes('?') ? '&' : '?'
    const url = `${treesUrl}${sep}qs_id=${encodeURIComponent(qs_id)}`
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`Expected JSON; got HTTP ${res.status}: ${text.slice(0, 220)}`)
    }
    if (!res.ok) {
      throw new Error(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`)
    }
    const trees = Array.isArray(json?.trees) ? json.trees : []
    treesCacheRef.current = { ...treesCacheRef.current, [cacheKey]: trees }
    return trees
  }

  async function fetchTreesForQs(qs_id) {
    if (!qs_id) return
    setTreeFetchError('')

    const cacheKey = `${qs_id}\t${QS_TREES_CLIENT_CACHE_TAG}`
    const cached = treesCacheRef.current[cacheKey]
    if (cached) {
      setSelectedTrees(cached)
      setIsLoadingTrees(false)
      const avg = averageLastPrunedFromTrees(cached)
      if (avg != null) {
        setPruneQueueAvgLastPrunedByQsId((prev) => ({ ...prev, [qs_id]: avg }))
      }
      return
    }

    setIsLoadingTrees(true)
    setSelectedTrees([])
    try {
      const trees = await fetchTreesForQsData(qs_id)
      setSelectedTrees(trees)
      const avg = averageLastPrunedFromTrees(trees)
      if (avg != null) {
        setPruneQueueAvgLastPrunedByQsId((prev) => ({ ...prev, [qs_id]: avg }))
      }
    } catch (err) {
      setTreeFetchError(parseCloudFunctionError('Failed loading trees for this quarter section', err))
      setSelectedTrees([])
    } finally {
      setIsLoadingTrees(false)
    }
  }

  useEffect(() => {
    if (inventoryView !== 'prune-queue' || !user || !treesUrl.trim()) return
    if (!Array.isArray(pruningPriorityRows) || pruningPriorityRows.length === 0) return

    let cancelled = false
    async function backfillMissingAvgLastPruned() {
      const targets = pruningPriorityRows
        .filter((row) => row.avgLastPruned == null && !pruneQueueBackfillRef.current.has(row.qsId))
        .slice(0, PRUNE_QUEUE_METRICS_BACKFILL_LIMIT)

      for (const row of targets) {
        if (cancelled) return
        pruneQueueBackfillRef.current.add(row.qsId)
        try {
          const trees = await fetchTreesForQsData(row.qsId)
          const avg = averageLastPrunedFromTrees(trees)
          if (avg != null && !cancelled) {
            setPruneQueueAvgLastPrunedByQsId((prev) => ({ ...prev, [row.qsId]: avg }))
          }
        } catch {
          // Ignore per-row failures; rankings still show other columns.
        }
      }
    }

    void backfillMissingAvgLastPruned()
    return () => {
      cancelled = true
    }
  }, [inventoryView, pruningPriorityRows, user, treesUrl])

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface text-on-surface">
      <AppNavbar />

      <div className="relative h-[calc(100vh-4rem)] w-full overflow-hidden pt-0 mt-16">
        <div
          className={`absolute inset-0 z-[1100] flex items-center justify-center bg-slate-100/80 backdrop-blur-sm transition-opacity duration-300 ease-out ${
            loading ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          aria-busy={loading}
          aria-hidden={!loading}
        >
          <div className="rounded-xl border border-white/30 bg-white/70 px-5 py-3 text-sm text-slate-700 shadow-xl">
            Loading quarter section map...
          </div>
        </div>
        {error ? (
          <div className="absolute left-[380px] top-4 z-[1200] max-w-md rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 shadow-xl backdrop-blur-sm">
            {error}
          </div>
        ) : null}
        {noPolygonFeatures ? (
          <div className="absolute left-[380px] top-4 z-[1150] max-w-md rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-xl backdrop-blur-sm">
            No quarter sections with geometry were returned from the map data service. Confirm polygons
            exist and that the geometry column matches your deployment.
          </div>
        ) : null}
        {noQsWithTreesOnMap ? (
          <div className="absolute left-[380px] top-4 z-[1150] max-w-md rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-xl backdrop-blur-sm">
            No quarter sections have trees to display on the map.
          </div>
        ) : null}
        {noQsMatchScoreTreeFilters && inventoryView === 'map' ? (
          <div className="absolute left-[380px] top-4 z-[1150] max-w-md rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-xl backdrop-blur-sm">
            No quarter sections match the current map filters (priority score, minimum trees, or
            district). Adjust Map Controls to see polygons.
          </div>
        ) : null}
        
        <div className="absolute inset-0">
        <Map
          ref={mapRef}
          initialViewState={{ latitude: mapCenter[0], longitude: mapCenter[1], zoom: DEFAULT_ZOOM }}
          mapStyle={DEFAULT_MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          interactiveLayerIds={
            inventoryView === 'map' ? [TREE_LAYER_ID, QS_FILL_LAYER_ID] : []
          }
          onClick={inventoryView === 'map' ? onMapClick : undefined}
          className={inventoryView === 'map' ? '' : 'pointer-events-none invisible'}
        >
          <NavigationControl position="bottom-right" />
          <Source
            id={QS_SOURCE_ID}
            type="geojson"
            data={tunedQsMapGeojsonForMap ?? EMPTY_FEATURE_COLLECTION}
          >
            <Layer {...qsFillLayer} filter={qsMapLayerFilter} />
            <Layer {...qsLineLayer} filter={qsMapLayerFilter} />
          </Source>
          <Source id={QS_LABEL_SOURCE_ID} type="geojson" data={qsLabelGeojson}>
            <Layer {...qsLabelLayer} filter={qsMapLayerFilter} />
          </Source>
          <Source id={TREE_SOURCE_ID} type="geojson" data={treeGeojson}>
            <Layer {...treeLayer} />
          </Source>
          {treePopup ? (
            <Popup
              latitude={treePopup.latitude}
              longitude={treePopup.longitude}
              closeOnClick={false}
              onClose={() => {
                setTreePopup(null)
                setFocusedTreeSiteId(null)
              }}
            >
              <div className="text-sm">
                <div className="font-semibold">Tree</div>
                <div>Priority Score: {Number(treePopup.tree.priority_score || 0).toFixed(3)}</div>
                <div>
                  Species:{' '}
                  {treePopup.tree.species != null && treePopup.tree.species !== ''
                    ? String(treePopup.tree.species)
                    : 'N/A'}
                </div>
                <div>DBH: {Number(treePopup.tree.dbh || 0).toFixed(1)}"</div>
                <div>
                  Height:{' '}
                  {treePopup.tree.height != null && Number.isFinite(treePopup.tree.height)
                    ? `${treePopup.tree.height.toFixed(1)} ft`
                    : 'N/A'}
                </div>
                <div>
                  Condition:{' '}
                  {treePopup.tree.condition != null && treePopup.tree.condition !== ''
                    ? String(treePopup.tree.condition)
                    : 'N/A'}
                </div>
              </div>
            </Popup>
          ) : null}
        </Map>

        {inventoryView === 'prune-queue' ? (
          <div
            className="absolute z-[500] overflow-auto bg-slate-50/96 backdrop-blur-sm"
            style={{ left: sidebarWidthPx, top: 0, right: 0, bottom: 0 }}
          >
            <div className="mx-auto max-w-6xl px-4 py-6">
              <div className="mb-4">
                <h1 className="text-lg font-bold text-slate-900">Pruning priority</h1>
                <p className="mt-1 text-sm text-slate-600">
                  All quarter sections from <code className="rounded bg-slate-200/80 px-1 text-xs">qs_priority</code>,
                  ranked by <strong>PS composite</strong>. Map colors use the same metric for sections with
                  polygon geometry; sections without geometry appear here but not on the map.
                </p>
              </div>
              {loadFinishedOk && pruningPriorityRows.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
                  No quarter sections loaded from summaries. Check that{' '}
                  <code className="rounded bg-slate-100 px-1 text-xs">getQuarterSectionSummaries</code> is
                  returning data.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="max-h-[calc(100vh-14rem)] overflow-auto">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 backdrop-blur-sm">
                        <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-3">#</th>
                          <PruneQueueSortHeader
                            label="Quarter section"
                            columnKey="qsId"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <PruneQueueSortHeader
                            label="PS composite"
                            columnKey="psComposite"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <PruneQueueSortHeader
                            label="Level"
                            columnKey="priorityLevel"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <PruneQueueSortHeader
                            label="District"
                            columnKey="district"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <PruneQueueSortHeader
                            label="Trees"
                            columnKey="treeCount"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3 text-right"
                          />
                          <PruneQueueSortHeader
                            label="Top species"
                            columnKey="topSpecies"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <PruneQueueSortHeader
                            label="Avg last pruned"
                            columnKey="avgLastPruned"
                            activeKey={pruneQueueSort.key}
                            direction={pruneQueueSort.direction}
                            onSort={handlePruneQueueSort}
                            className="px-3 py-3"
                          />
                          <th className="px-3 py-3 w-32"> </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800">
                        {sortedPruningPriorityRows.map((row, i) => (
                          <tr key={row.qsId} className="hover:bg-slate-50/80">
                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{i + 1}</td>
                            <td className="px-3 py-2.5 font-semibold text-slate-900">{row.qsId}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: colorFromScore(
                                      row.psComposite,
                                      scoreBounds.min,
                                      scoreBounds.max,
                                    ),
                                  }}
                                  title={`PS ${formatPsComposite(row.psComposite)} (map color scale)`}
                                />
                                <div>
                                  <div className="font-mono tabular-nums text-slate-900">
                                    {formatPsComposite(row.psComposite)}
                                  </div>
                                  <div className="text-[10px] tabular-nums text-slate-400">
                                    P{Number(row.psPercentile || 0).toFixed(0)} in list
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${priorityLevelBadgeClass(row.relativeLevel ?? row.priorityLevel)}`}
                              >
                                {row.relativeLevel ?? row.priorityLevel}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">{row.district}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{row.treeCount}</td>
                            <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-600" title={row.topSpecies}>
                              {row.topSpecies}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                              {formatAvgLastPruned(row.avgLastPruned)}
                            </td>
                            <td className="px-3 py-2.5">
                              {row.hasMapGeometry !== false &&
                              Number.isFinite(row.centerLat) &&
                              Number.isFinite(row.centerLon) ? (
                                <button
                                  type="button"
                                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                                  onClick={() => focusQsFromPruningQueue(row)}
                                >
                                  Map
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400" title="No polygon geometry for this quarter section">
                                  No map
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
        </div>

        <div className={`absolute left-0 top-0 bottom-0 z-[1000] flex flex-col border-r border-slate-200/60 bg-white/95 shadow-[4px_0_24px_rgba(0,0,0,0.05)] backdrop-blur-xl transition-all duration-300 ease-in-out ${panelOpen ? 'w-[360px]' : 'w-14'}`}>
          {/* Panel Header & Toggle */}
          <div className={`flex items-center justify-between border-b border-slate-200/60 px-4 py-4 bg-slate-50/50 ${!panelOpen ? 'justify-center' : ''}`}>
            {panelOpen && (
              <div className="min-w-0 flex-1 pr-2">
                <h2 className="text-sm !font-bold !text-slate-800">Milwaukee Tree Priority Map</h2>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-0.5">
                  Inventory
                </p>
                <div className="mt-3 flex gap-1 rounded-lg bg-slate-200/60 p-0.5">
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold transition-colors ${
                      inventoryView === 'map'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setInventoryView('map')}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold transition-colors ${
                      inventoryView === 'prune-queue'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    onClick={() => setInventoryView('prune-queue')}
                    title="Quarter sections to prune next, by priority score"
                  >
                    Prune next
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              className="flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors"
              onClick={() => setPanelOpen((v) => !v)}
              title={panelOpen ? 'Hide Panel' : 'Show Panel'}
            >
              <span className="material-symbols-outlined">{panelOpen ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right'}</span>
            </button>
          </div>

          {!panelOpen ? (
            <div className="flex flex-col items-center gap-1 border-b border-slate-200/60 py-2">
              <button
                type="button"
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  inventoryView === 'map'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
                title="Map"
                onClick={() => setInventoryView('map')}
              >
                <span className="material-symbols-outlined text-xl leading-none">map</span>
              </button>
              <button
                type="button"
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  inventoryView === 'prune-queue'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
                title="Pruning priority list"
                onClick={() => setInventoryView('prune-queue')}
              >
                <span className="material-symbols-outlined text-xl leading-none">format_list_numbered</span>
              </button>
            </div>
          ) : null}

          {/* Scrollable Content Area */}
          {panelOpen && (
            <div className="flex-1 overflow-y-auto p-6 space-y-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              
              {/* Overview Section */}
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Overview</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className={STAT_CARD_CLASS}>
                    <p className={STAT_LABEL_CLASS}>Qtr Sections</p>
                    <p className={STAT_VALUE_CLASS}>{displayStatistics?.total_quarter_sections ?? '—'}</p>
                  </div>
                  <div className={STAT_CARD_CLASS}>
                    <p className={STAT_LABEL_CLASS}>Total Trees</p>
                    <p className={STAT_VALUE_CLASS}>{displayStatistics?.total_trees?.toLocaleString?.() ?? '—'}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                  District
                </h3>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Filter</label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                  >
                    {DISTRICT_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                  PS composite
                </h3>
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-3">
                    <span>Min: {formatPsComposite(psMin)}</span>
                    <span>Max: {formatPsComposite(psMax)}</span>
                  </div>
                  <div className="space-y-4">
                    <input
                      className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
                      type="range"
                      min={psFilterBounds.min}
                      max={psFilterBounds.max}
                      step={psFilterBounds.step}
                      value={Math.min(Math.max(psMin, psFilterBounds.min), psFilterBounds.max)}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setPsMin(Math.min(next, psMax))
                      }}
                    />
                    <input
                      className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
                      type="range"
                      min={psFilterBounds.min}
                      max={psFilterBounds.max}
                      step={psFilterBounds.step}
                      value={Math.min(Math.max(psMax, psFilterBounds.min), psFilterBounds.max)}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setPsMax(Math.max(next, psMin))
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                  Minimum Trees
                </h3>
                <div>
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase mb-3">
                    <span>Per quarter section</span>
                    <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{treeMin}</span>
                  </div>
                  <input
                    className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
                    type="range"
                    min={0}
                    max={1000}
                    value={treeMin}
                    onChange={(e) => setTreeMin(Number(e.target.value))}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                  Display
                </h3>
                <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 accent-indigo-600 focus:ring-indigo-600 w-4 h-4"
                    checked={showTrees}
                    onChange={(e) => setShowTrees(e.target.checked)}
                  />
                  <span className="text-sm font-semibold text-slate-700">Render Tree Points</span>
                </label>
              </section>

              <PriorityTuningPanel
                tuning={priorityTuning}
                onTuningChange={setPriorityTuning}
                breakdown={priorityFactorBreakdown}
              />

            </div>
          )}
        </div>
        {/* --- END REFACTORED FLUSH LEFT SIDEBAR --- */}

        {selectedQs ? (
          <div className="absolute right-4 top-4 z-[1000] w-[min(400px,calc(100vw-2rem))] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-white/30 bg-white/70 p-4 text-sm text-slate-700 shadow-xl backdrop-blur-md [scrollbar-width:thin]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Quarter Section {selectedQs.qs_id ?? selectedQs.QTRSEC ?? selectedQs.quarter_section ?? 'N/A'}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex items-center justify-center rounded px-1.5 py-1 text-slate-600 transition-colors hover:bg-slate-900/5 hover:text-slate-900"
                  onClick={() => setQsDetailsExpanded((prev) => !prev)}
                  title={qsDetailsExpanded ? 'Collapse details' : 'Expand details'}
                  aria-label={qsDetailsExpanded ? 'Collapse details' : 'Expand details'}
                >
                  <span className="material-symbols-outlined text-base leading-none">
                    {qsDetailsExpanded ? 'keyboard_double_arrow_up' : 'keyboard_double_arrow_down'}
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => {
                    setSelectedQs(null)
                    setFocusedTreeSiteId(null)
                    setTreePopup(null)
                    setSelectedTrees([])
                    setTreeFetchError('')
                    setQsDetailsExpanded(true)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            {qsDetailsExpanded ? (
              <>
                <div className="mb-2 font-semibold text-slate-800">Inventory insights</div>
                <InventoryInsightPanel
                  selectedQs={selectedQs}
                  selectedTrees={selectedTrees}
                  displayAverageDbh={displayAverageDbh}
                  isLoadingTrees={isLoadingTrees}
                  treeFetchError={treeFetchError}
                  focusedTreeSiteId={focusedTreeSiteId}
                  shapQuery={shapExplanationQuery}
                  shapConfigured={Boolean(shapExplanationUrl.trim())}
                  formatError={parseCloudFunctionError}
                  priorityLevelBadgeClass={priorityLevelBadgeClass}
                />
              </>
            ) : (
              <div className="rounded-md border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
                Details collapsed.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
