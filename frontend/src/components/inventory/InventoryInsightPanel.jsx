import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildQsInventoryStats,
  estimatedAgeHistogramFromTrees,
  formatAvgLastPruned,
  formatShapFeatureLabel,
  formatTreePriorityScore,
  priorityScoreHistogramFromTrees,
  speciesBreakdownFromTrees,
} from '../../utils/inventoryStats.js'
import { formatPsComposite } from '../../utils/priorityModel.js'
import {
  formatTreeMetric,
  treeAgePrioritization,
  treeImpactOfFailure,
  treeProbabilityOfFailure,
} from '../../utils/treeFeatureMetrics.js'
import { shapSiteIdFromTree } from '../../utils/shapLookup.js'
import { InterpretHelp } from './InterpretHelp.jsx'
import {
  QS_INSIGHT_HELP_TITLE,
  QsInsightHelpContent,
  TREE_INSIGHT_HELP_TITLE,
  TreeInsightHelpContent,
} from './inventoryHelpCopy.jsx'

/**
 * @param {object} props
 * @param {string} props.title
 * @param {boolean} props.isLoadingTrees
 * @param {string} props.treeFetchError
 * @param {{ name: string, value: number }[]} props.data
 * @param {string} props.emptyMessage
 * @param {string} props.barFill
 * @param {(label: string) => string} props.tooltipLabel
 */
function QsHistogramSection({
  title,
  isLoadingTrees,
  treeFetchError,
  data,
  emptyMessage,
  barFill,
  tooltipLabel,
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      {isLoadingTrees ? (
        <p className="text-xs text-slate-500">Loading trees…</p>
      ) : treeFetchError ? (
        <p className="text-xs text-red-700">{treeFetchError}</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="h-40 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 8, fill: '#64748b' }}
                interval={0}
                angle={-32}
                textAnchor="end"
                height={48}
              />
              <YAxis
                allowDecimals={false}
                width={40}
                tick={{ fontSize: 9, fill: '#64748b' }}
                tickMargin={2}
                label={{
                  value: 'Trees',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 12,
                  style: { fontSize: 9, fill: '#64748b', textAnchor: 'middle' },
                }}
              />
              <Tooltip
                formatter={(value) => [value, 'Trees']}
                labelFormatter={(label) => tooltipLabel(label)}
                contentStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="value" fill={barFill} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

const PIE_COLORS = [
  '#4f46e5',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be185d',
  '#65a30d',
]

/**
 * @param {object} props
 * @param {Record<string, unknown>} props.selectedQs
 * @param {Array<Record<string, unknown>>} props.selectedTrees
 * @param {number | null} props.displayAverageDbh
 * @param {boolean} props.isLoadingTrees
 * @param {string} props.treeFetchError
 * @param {string | null} props.focusedTreeSiteId
 * @param {import('@tanstack/react-query').UseQueryResult<{ englishTranslation: string | null, contributions: { feature: string, value: number }[] } | null, Error>} props.shapQuery
 * @param {boolean} props.shapConfigured
 * @param {(msg: string, err: unknown, body?: string) => string} props.formatError
 * @param {(level: string) => string} props.priorityLevelBadgeClass
 */
export function InventoryInsightPanel({
  selectedQs,
  selectedTrees,
  displayAverageDbh,
  isLoadingTrees,
  treeFetchError,
  focusedTreeSiteId,
  shapQuery,
  shapConfigured,
  formatError,
  priorityLevelBadgeClass,
}) {
  const [view, setView] = useState(/** @type {'qs' | 'tree'} */ ('qs'))

  useEffect(() => {
    if (focusedTreeSiteId) setView('tree')
  }, [focusedTreeSiteId])

  const qsId =
    String(selectedQs.qs_id ?? selectedQs.QTRSEC ?? selectedQs.quarter_section ?? 'N/A')

  const qsStats = useMemo(
    () => buildQsInventoryStats(selectedQs, selectedTrees, displayAverageDbh),
    [selectedQs, selectedTrees, displayAverageDbh],
  )

  const speciesPie = useMemo(() => speciesBreakdownFromTrees(selectedTrees), [selectedTrees])

  const priorityHistogram = useMemo(
    () => priorityScoreHistogramFromTrees(selectedTrees),
    [selectedTrees],
  )

  const ageHistogram = useMemo(
    () => estimatedAgeHistogramFromTrees(selectedTrees),
    [selectedTrees],
  )

  const focusedTree = useMemo(() => {
    if (!focusedTreeSiteId) return null
    return (
      selectedTrees.find((t) => {
        const id = String(t?.tree_id ?? t?.tree_row_id ?? '').trim()
        return id && id === focusedTreeSiteId
      }) ?? null
    )
  }, [selectedTrees, focusedTreeSiteId])

  const shapBars = useMemo(() => {
    const rows = shapQuery.data?.contributions ?? []
    return rows.map((r) => ({
      feature: formatShapFeatureLabel(r.feature),
      value: r.value,
      abs: Math.abs(r.value),
    }))
  }, [shapQuery.data?.contributions])

  return (
    <div className="mt-3 space-y-3">
      <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-bold uppercase tracking-wide">
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
            view === 'qs' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setView('qs')}
        >
          Quarter section
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
            view === 'tree' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setView('tree')}
        >
          Tree
        </button>
      </div>

      {view === 'qs' ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${priorityLevelBadgeClass(qsStats.priorityLevel)}`}
              >
                {qsStats.priorityLevel}
              </span>
              <span className="text-[10px] text-slate-500">{qsStats.district}</span>
            </div>
            <InterpretHelp title={QS_INSIGHT_HELP_TITLE}>
              <QsInsightHelpContent />
            </InterpretHelp>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <Stat label="Trees in section" value={String(qsStats.treeCount)} />
            <Stat label="PS composite" value={formatPsComposite(qsStats.psComposite)} />
            <Stat
              label="Avg tree priority (0–1)"
              value={
                qsStats.avgPriority != null ? formatTreePriorityScore(qsStats.avgPriority) : '—'
              }
            />
            <Stat
              label="Avg DBH"
              value={qsStats.displayAverageDbh != null ? `${qsStats.displayAverageDbh.toFixed(1)}"` : '—'}
            />
            <Stat label="Can strike building" value={String(qsStats.strikeCount)} />
            <Stat label="Species represented" value={String(qsStats.speciesCount)} />
            <Stat label="Dominant species" value={qsStats.dominantSpecies} />
            <Stat label="Latest inspection year" value={qsStats.inspectionYear} />
            <Stat
              label="Avg last pruned"
              value={
                isLoadingTrees && qsStats.avgLastPruned == null
                  ? '…'
                  : formatAvgLastPruned(qsStats.avgLastPruned)
              }
            />
          </div>

          <QsHistogramSection
            title="Tree priority distribution"
            isLoadingTrees={isLoadingTrees}
            treeFetchError={treeFetchError}
            data={priorityHistogram}
            emptyMessage="No priority scores for trees in this section."
            barFill="#4f46e5"
            tooltipLabel={(label) => `Score ${label}`}
          />

          <QsHistogramSection
            title="Estimated age distribution"
            isLoadingTrees={isLoadingTrees}
            treeFetchError={treeFetchError}
            data={ageHistogram}
            emptyMessage="No estimated ages for trees in this section."
            barFill="#059669"
            tooltipLabel={(label) => `Age ${label}`}
          />

          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Species breakdown
            </p>
            {isLoadingTrees ? (
              <p className="text-xs text-slate-500">Loading trees…</p>
            ) : treeFetchError ? (
              <p className="text-xs text-red-700">{treeFetchError}</p>
            ) : speciesPie.length === 0 ? (
              <p className="text-xs text-slate-500">No trees loaded for this quarter section.</p>
            ) : (
              <div className="h-36 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={speciesPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={52}
                      paddingAngle={1}
                    >
                      {speciesPie.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [value, name]}
                      contentStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected tree</p>
            <InterpretHelp title={TREE_INSIGHT_HELP_TITLE}>
              <TreeInsightHelpContent />
            </InterpretHelp>
          </div>

          {!focusedTreeSiteId || !focusedTree ? (
            <p className="text-xs text-slate-500">
              Select a tree point on the map to see score drivers and condition details for{' '}
              <span className="font-mono text-slate-700">{qsId}</span>.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white/80 p-2">
                <p className="text-[11px] font-semibold text-slate-900">
                  <span className="font-sans text-slate-700">Tree ID:</span>{' '}
                  <span className="font-mono">{String(focusedTree.tree_id ?? focusedTreeSiteId)}</span>
                </p>
                {shapSiteIdFromTree(focusedTree) ? (
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    <span className="font-sans">Site ID (SHAP):</span>{' '}
                    <span className="font-mono">{shapSiteIdFromTree(focusedTree)}</span>
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] leading-snug text-slate-500">
                  {String(focusedTree.species ?? 'Unknown')}
                  {' · '}
                  {Number(focusedTree.dbh || 0).toFixed(0)}&quot; DBH
                  {' · '}
                  {focusedTree.height != null && Number.isFinite(Number(focusedTree.height))
                    ? `${Number(focusedTree.height).toFixed(0)} ft`
                    : '—'}
                  {' · '}
                  {Number(focusedTree.crown_diameter_m) > 0
                    ? `${Number(focusedTree.crown_diameter_m).toFixed(1)} m crown`
                    : '— crown'}
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-white/70 p-2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Priority explanation
                </p>
                {shapConfigured ? (
                  <>
                    {!shapSiteIdFromTree(focusedTree) ? (
                      <p className="mb-3 text-xs text-amber-800">
                        No Site ID on this tree record — SHAP explanations are keyed by municipal Site ID,
                        not Tree ID.
                      </p>
                    ) : shapQuery.isPending ? (
                      <LoadingRow label="Loading priority explanation…" />
                    ) : shapQuery.isError ? (
                      <p className="text-xs text-red-700">
                        {formatError('Could not load priority explanation', shapQuery.error)}
                      </p>
                    ) : shapQuery.data?.englishTranslation ? (
                      <p className="mb-3 text-xs leading-relaxed text-slate-800">
                        {shapQuery.data.englishTranslation}
                      </p>
                    ) : (
                      <p className="mb-3 text-xs text-slate-500">
                        No narrative explanation on file for this tree.
                      </p>
                    )}
                    {shapQuery.isPending ? null : shapQuery.isError ? null : shapBars.length === 0 ? (
                      <p className="text-xs text-slate-500">No SHAP contribution fields found for this tree.</p>
                    ) : (
                      <ul className="max-h-40 space-y-1 overflow-y-auto [scrollbar-width:thin]">
                        {shapBars.map((row) => (
                          <li key={row.feature} className="flex items-center gap-2 text-[10px]">
                            <span className="w-[42%] shrink-0 truncate text-slate-600" title={row.feature}>
                              {row.feature}
                            </span>
                            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${row.value >= 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{
                                  width: `${Math.min(100, (row.abs / (shapBars[0]?.abs || 1)) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right font-mono text-slate-800">
                              {row.value >= 0 ? '+' : ''}
                              {row.value.toFixed(3)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Set VITE_CF_GET_TREE_SHAP_EXPLANATION_URL to load SHAP explanations.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Stat
                  label="Priority score (0–1)"
                  value={formatTreePriorityScore(focusedTree.priority_score)}
                />
                <Stat
                  label="Impact of failure (I_f)"
                  value={formatTreeMetric(treeImpactOfFailure(focusedTree))}
                />
                <Stat
                  label="Probability of failure (p_f)"
                  value={formatTreeMetric(treeProbabilityOfFailure(focusedTree))}
                />
                <Stat
                  label="Age prioritization (a_p)"
                  value={formatTreeMetric(treeAgePrioritization(focusedTree))}
                />
                <Stat label="Estimated age" value={`${Number(focusedTree.age || 0).toFixed(0)} yr`} />
                <Stat
                  label="Maintenance deficit"
                  value={String(focusedTree.maintenance_deficit ?? 0)}
                />
                <Stat
                  label="Years since pruned"
                  value={String(focusedTree.years_since_pruned ?? 0)}
                />
                <Stat
                  label="Can strike building"
                  value={focusedTree.can_strike_building ? 'Yes' : 'No'}
                />
                <Stat
                  label="Condition"
                  value={String(focusedTree.condition_aerial ?? focusedTree.condition ?? '—')}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 */
function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white/60 px-2 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xs font-semibold text-slate-800" title={value}>
        {value}
      </p>
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.label
 */
function LoadingRow({ label }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
        aria-hidden
      />
      <span>{label}</span>
    </div>
  )
}
