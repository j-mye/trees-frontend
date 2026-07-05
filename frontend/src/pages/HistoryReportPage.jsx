import { useEffect, useMemo, useRef, useState } from 'react'
import AppNavbar from '../components/AppNavbar.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'
import { useSummariesFeaturesQuery } from '../analytics/useAnalyticsData.js'
import { usePriorityHistory } from '../hooks/usePriorityHistory.js'

const CHART_COLORS = ['#4c56af', '#6b7ae8', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
const SCOPE_OPTIONS = [
  { id: 'district', label: 'District' },
  { id: 'quarter_section', label: 'Quarter Section' },
]

function isUnknownDistrict(name) {
  return String(name || '').trim().toLowerCase() === 'unknown' || !String(name || '').trim()
}

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(4)
}

function formatMetricValue(value, decimals = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals)
}

function formatAxisTick(value, decimals = 2) {
  if (value == null || !Number.isFinite(Number(value))) return ''
  const n = Number(value)
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals)
}

function formatDelta(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  const prefix = n > 0 ? '+' : ''
  return `${prefix}${n.toFixed(4)}`
}

function formatShortDate(isoOrMs) {
  if (isoOrMs == null) return ''
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs)
  if (Number.isNaN(d.getTime())) return String(isoOrMs)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatAxisDate(ms, { compact = false } = {}) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  if (compact) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return formatShortDate(ms)
}

const X_DATE_LABEL_MIN_GAP_PX = 68
const X_DATE_LABEL_LINE_HEIGHT = 13

/**
 * Group x ticks that would overlap and stack their labels when clustered.
 * @param {{ minMs: number, span: number, ticks: number[] }} timeScale
 * @param {(x: number) => number} xPx
 * @param {number} plotLeft
 * @param {number} plotRight
 */
function layoutXDateLabels(timeScale, xPx, plotLeft, plotRight) {
  const { minMs, span, ticks } = timeScale
  if (!ticks.length) return []

  const points = ticks.map((tickX) => ({
    tickX,
    x: xPx(tickX),
    ms: minMs + tickX * span,
  }))

  const groups = []
  let current = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (points[i].x - current[current.length - 1].x < X_DATE_LABEL_MIN_GAP_PX) {
      current.push(points[i])
    } else {
      groups.push(current)
      current = [points[i]]
    }
  }
  groups.push(current)

  return groups.map((group, groupIndex) => {
    const isFirstGroup = groupIndex === 0
    const isLastGroup = groupIndex === groups.length - 1
    const useCompact = group.length > 1

    if (group.length === 1) {
      const pt = group[0]
      let textAnchor = 'middle'
      let x = pt.x
      if (pt.tickX <= 0.05) {
        textAnchor = 'start'
        x = plotLeft
      } else if (pt.tickX >= 0.95) {
        textAnchor = 'end'
        x = plotRight
      }
      return {
        x,
        textAnchor,
        lines: [formatAxisDate(pt.ms)],
        tickXs: [pt.tickX],
      }
    }

    const anchorX = isLastGroup ? plotRight : isFirstGroup ? plotLeft : (group[0].x + group[group.length - 1].x) / 2
    const textAnchor = isLastGroup ? 'end' : isFirstGroup ? 'start' : 'middle'
    return {
      x: anchorX,
      textAnchor,
      lines: group.map((pt) => formatAxisDate(pt.ms, { compact: useCompact })),
      tickXs: group.map((pt) => pt.tickX),
    }
  })
}

function recordedAtToMs(iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Map timestamps to x ∈ [0, 1]: 0 = earliest point, 1 = latest sync.
 * @param {number[]} timesMs
 */
function buildTimeScale(timesMs) {
  const times = [...new Set(timesMs.filter((ms) => Number.isFinite(ms)))].sort((a, b) => a - b)
  if (times.length === 0) {
    return { minMs: 0, maxMs: 1, span: 1, toX: () => null, ticks: [] }
  }
  const minMs = times[0]
  const maxMs = times[times.length - 1]
  const span = maxMs - minMs
  const toX = (ms) => {
    if (!Number.isFinite(ms)) return null
    if (span === 0) return 0.5
    return (ms - minMs) / span
  }
  return { minMs, maxMs, span, toX, ticks: times.map(toX) }
}

function collectRecordedAtMs(points) {
  const times = []
  for (const pt of points ?? []) {
    const ms = recordedAtToMs(pt.recorded_at)
    if (Number.isFinite(ms)) times.push(ms)
  }
  return times
}

/** @param {{ min?: number, max?: number, pad?: number }} yRange */
function resolveYRange(series, yRange) {
  const values = series.flatMap((s) => s.data.map((d) => Number(d.y))).filter(Number.isFinite)
  if (values.length === 0) return { min: 0, max: 1 }
  if (yRange?.min != null && yRange?.max != null) {
    return { min: yRange.min, max: yRange.max }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = yRange?.pad ?? 0.08
  const span = Math.max(max - min, 0.001)
  return { min: Math.max(0, min - span * pad), max: max + span * pad }
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
function ChartSizeContainer({ children }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setSize({ width: Math.round(width), height: Math.round(height) })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="h-full w-full min-h-0 min-w-0">
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  )
}

/**
 * @param {object} props
 * @param {{ left: number, top: number, epoch: { recorded_at: string, is_baseline_load?: boolean, items: Array<{ name: string, color: string, y: number }> } }} props.hover
 * @param {(value: number) => string} props.formatValue
 * @param {number} props.containerWidth
 */
function ChartHoverTooltip({ hover, formatValue, containerWidth }) {
  const { epoch, left, top } = hover
  const dateLabel = epoch.is_baseline_load
    ? `${formatWhen(epoch.recorded_at)} · last loaded inventory`
    : formatWhen(epoch.recorded_at)
  const tooltipWidth = 232
  const adjustedLeft =
    left + tooltipWidth > containerWidth ? Math.max(8, left - tooltipWidth - 16) : Math.max(8, left)

  return (
    <div
      className="pointer-events-none absolute z-20 w-[232px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
      style={{ left: adjustedLeft, top: Math.max(8, top) }}
    >
      <p className="font-semibold leading-snug text-slate-800">{dateLabel}</p>
      <div className="mt-1.5 space-y-1">
        {epoch.items.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-slate-900">{formatValue(item.y)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * SVG time-series chart with x ∈ [0, 1] mapped to full plot width.
 * @param {object} props
 * @param {number} props.width
 * @param {number} props.height
 * @param {Array<{ id: string, name: string, data: object[], color?: string }>} props.series
 * @param {{ minMs: number, span: number, ticks: number[] }} props.timeScale
 * @param {(value: number) => string} [props.formatValue]
 * @param {(value: number) => string} [props.formatYTick]
 * @param {{ min?: number, max?: number, pad?: number }} [props.yRange]
 * @param {string} [props.yAxisLabel]
 * @param {boolean} [props.showLegend]
 * @param {boolean} [props.showXLabel]
 */
function HistoryTimeSeriesChart({
  width,
  height,
  series,
  timeScale,
  formatValue = formatScore,
  formatYTick = formatAxisTick,
  yRange,
  yAxisLabel,
  showLegend = false,
  showXLabel = false,
}) {
  const containerRef = useRef(null)
  const [hover, setHover] = useState(null)
  const plotLeft = 52
  const plotRight = width - 20
  const plotW = Math.max(plotRight - plotLeft, 1)
  const xPx = (x) => plotLeft + x * plotW

  const xTickLayouts = useMemo(
    () => layoutXDateLabels(timeScale, xPx, plotLeft, plotRight),
    [timeScale, plotW, plotLeft, plotRight],
  )
  const maxDateLabelLines = Math.max(1, ...xTickLayouts.map((layout) => layout.lines.length))
  const dateLabelsHeight = maxDateLabelLines * X_DATE_LABEL_LINE_HEIGHT + 6
  const axisTitleHeight = showXLabel ? 18 : 0
  const legendHeight = showLegend ? 22 : 0
  const margin = {
    top: 16,
    right: 20,
    bottom: dateLabelsHeight + axisTitleHeight + legendHeight + 10,
    left: plotLeft,
  }
  const plotH = Math.max(height - margin.top - margin.bottom, 1)
  const { min: yMin, max: yMax } = resolveYRange(series, yRange)
  const ySpan = Math.max(yMax - yMin, 0.0001)

  const yPx = (y) => margin.top + plotH - ((y - yMin) / ySpan) * plotH

  const yTicks = useMemo(() => {
    const count = 4
    return Array.from({ length: count + 1 }, (_, i) => yMin + (ySpan * i) / count)
  }, [yMin, ySpan])

  const { ticks } = timeScale
  const dateLabelStartY = margin.top + plotH + 14
  const axisTitleY = dateLabelStartY + maxDateLabelLines * X_DATE_LABEL_LINE_HEIGHT + 10
  const legendY = height - 8
  const legendItemWidth = 128
  const legendTotalWidth = series.length * legendItemWidth
  const legendStartX = margin.left + Math.max((plotW - legendTotalWidth) / 2, 0)

  const epochs = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < series.length; i++) {
      const s = series[i]
      const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length]
      for (const d of s.data) {
        const key = String(d.recorded_at || '')
        if (!key) continue
        const bucket = map.get(key) ?? {
          recorded_at: d.recorded_at,
          is_baseline_load: Boolean(d.is_baseline_load),
          x: d.x,
          items: [],
        }
        bucket.items.push({ name: s.name, color, y: d.y })
        map.set(key, bucket)
      }
    }
    return [...map.values()].sort((a, b) => a.x - b.x)
  }, [series])

  const handlePlotHover = (clientX, clientY, svgMouseX) => {
    let nearest = null
    let minDist = Infinity
    for (const epoch of epochs) {
      const dist = Math.abs(xPx(epoch.x) - svgMouseX)
      if (dist < minDist) {
        minDist = dist
        nearest = epoch
      }
    }
    if (!nearest || minDist > 48) {
      setHover(null)
      return
    }
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    setHover({
      left: clientX - containerRect.left + 12,
      top: clientY - containerRect.top - 12,
      epoch: nearest,
      crosshairX: xPx(nearest.x),
    })
  }

  const handleSvgMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const svgMouseX = (event.clientX - rect.left) * scaleX
    const svgMouseY = (event.clientY - rect.top) * scaleY
    if (
      svgMouseX < margin.left ||
      svgMouseX > margin.left + plotW ||
      svgMouseY < margin.top ||
      svgMouseY > margin.top + plotH
    ) {
      setHover(null)
      return
    }
    handlePlotHover(event.clientX, event.clientY, svgMouseX)
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full cursor-crosshair"
        role="img"
        aria-label="History time series chart"
        onMouseMove={handleSvgMouseMove}
        onMouseLeave={() => setHover(null)}
      >
      {yTicks.map((tick) => {
        const y = yPx(tick)
        return (
          <g key={tick}>
            <line
              x1={margin.left}
              y1={y}
              x2={margin.left + plotW}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {formatYTick(tick)}
            </text>
          </g>
        )
      })}

      {ticks.map((tickX) => (
        <line
          key={tickX}
          x1={xPx(tickX)}
          y1={margin.top}
          x2={xPx(tickX)}
          y2={margin.top + plotH}
          stroke="#e2e8f0"
          strokeDasharray="3 3"
        />
      ))}

      {xTickLayouts.map((layout) => (
        <g key={layout.tickXs.join('|')}>
          {layout.lines.map((line, lineIndex) => (
            <text
              key={`${layout.tickXs.join('|')}-${lineIndex}`}
              x={layout.x}
              y={dateLabelStartY + lineIndex * X_DATE_LABEL_LINE_HEIGHT}
              textAnchor={layout.textAnchor}
              fontSize={11}
              fill="#64748b"
            >
              {line}
            </text>
          ))}
        </g>
      ))}

      {yAxisLabel ? (
        <text
          x={14}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fontWeight="bold"
          fill="#737c7f"
          transform={`rotate(-90 14 ${margin.top + plotH / 2})`}
        >
          {yAxisLabel}
        </text>
      ) : null}

      {showXLabel ? (
        <text
          x={margin.left + plotW / 2}
          y={axisTitleY}
          textAnchor="middle"
          fontSize={11}
          fontWeight="bold"
          fill="#737c7f"
        >
          Sync date
        </text>
      ) : null}

      {hover ? (
        <line
          x1={hover.crosshairX}
          y1={margin.top}
          x2={hover.crosshairX}
          y2={margin.top + plotH}
          stroke="#94a3b8"
          strokeWidth={1}
          strokeDasharray="4 4"
          pointerEvents="none"
        />
      ) : null}

      {series.map((s, i) => {
        const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length]
        const points = s.data
        if (points.length === 0) return null
        const polyline = points.map((d) => `${xPx(d.x)},${yPx(d.y)}`).join(' ')
        const isHighlighted = hover != null && hover.epoch.items.some((item) => item.name === s.name)
        return (
          <g key={s.id}>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth={isHighlighted ? 2.5 : 2}
              strokeOpacity={hover && !isHighlighted ? 0.35 : 1}
              points={polyline}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
            {points.map((d) => {
              const cx = xPx(d.x)
              const cy = yPx(d.y)
              const active =
                hover?.epoch.recorded_at === d.recorded_at &&
                hover.epoch.items.some((item) => item.name === s.name)
              return (
                <g key={`${s.id}-${d.recorded_at}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={active ? 7 : 5}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                </g>
              )
            })}
          </g>
        )
      })}

      {showLegend ? (
        <g transform={`translate(${legendStartX}, ${legendY})`}>
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length]
            const xOffset = i * legendItemWidth
            return (
              <g key={s.id} transform={`translate(${xOffset}, 0)`}>
                <line x1={0} y1={0} x2={18} y2={0} stroke={color} strokeWidth={2} />
                <circle cx={9} cy={0} r={4} fill={color} />
                <text x={24} y={4} fontSize={11} fill="#475569">
                  {s.name}
                </text>
              </g>
            )
          })}
        </g>
      ) : null}
      </svg>
      {hover ? (
        <ChartHoverTooltip hover={hover} formatValue={formatValue} containerWidth={width} />
      ) : null}
    </div>
  )
}

function isBaselineSyncRun(run) {
  const source = String(run?.source || '').trim().toLowerCase()
  const id = String(run?.sync_run_id || '').trim().toLowerCase()
  return source === 'baseline' || id === 'initial-load' || id.startsWith('initial')
}

function syncRunLabel(run) {
  if (isBaselineSyncRun(run)) return 'Initial inventory load'
  return run?.sync_run_id || '—'
}

/**
 * @param {Array<{ recorded_at: string, priority_score?: number, is_baseline_load?: boolean }>} points
 * @param {{ toX: (ms: number) => number | null }} timeScale
 */
function pointsToScatterData(points, timeScale, valueKey) {
  return (points ?? [])
    .map((pt) => {
      const recorded_at_ms = recordedAtToMs(pt.recorded_at)
      const x = timeScale.toX(recorded_at_ms)
      const y = pt[valueKey]
      return {
        recorded_at: pt.recorded_at,
        recorded_at_ms,
        x,
        y,
        is_baseline_load: Boolean(pt.is_baseline_load),
      }
    })
    .filter(
      (row) =>
        Number.isFinite(row.x) && row.y != null && Number.isFinite(row.y) && Number.isFinite(row.recorded_at_ms),
    )
    .sort((a, b) => a.recorded_at_ms - b.recorded_at_ms)
}

function priorityPointsToLineData(points, timeScale) {
  return pointsToScatterData(points, timeScale, 'priority_score')
}

function metricPointsToLineData(points, timeScale) {
  return pointsToScatterData(points, timeScale, 'value')
}

/**
 * @param {{ id: string, label: string, decimals?: number, points: Array<{ recorded_at: string, value: number }> }} metric
 */
function MetricTrendChart({ metric }) {
  const timeScale = useMemo(
    () => buildTimeScale(collectRecordedAtMs(metric.points)),
    [metric.points],
  )
  const lineData = useMemo(
    () => metricPointsToLineData(metric.points, timeScale),
    [metric.points, timeScale],
  )
  const decimals = metric.decimals ?? 1
  const isCount = metric.id === 'tree_count' || metric.id === 'species_richness'

  if (lineData.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">{metric.label}</h3>
        <p className="mt-4 py-8 text-center text-sm text-slate-500">No data for this metric.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800">{metric.label}</h3>
      <p className="mt-0.5 text-xs text-slate-500">Change over time across filtered trees</p>
      <div className="mt-3 h-[220px] w-full min-w-0">
        <ChartSizeContainer>
          {(size) => (
            <HistoryTimeSeriesChart
              width={size.width}
              height={size.height}
              series={[{ id: metric.id, name: metric.label, data: lineData, color: '#4c56af' }]}
              timeScale={timeScale}
              formatValue={(v) => formatMetricValue(v, isCount ? 0 : decimals)}
              formatYTick={(v) => formatAxisTick(v, isCount ? 0 : decimals)}
            />
          )}
        </ChartSizeContainer>
      </div>
    </div>
  )
}

function SyncRunsTable({ syncRuns }) {
  if (syncRuns.length === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-bold text-slate-800">Sync runs</h2>
        <p className="text-xs text-slate-500">Initial inventory load and TreeKeeper sync executions</p>
      </div>
      <div className="max-h-[320px] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Run ID</th>
              <th className="px-4 py-3 text-right">Trees changed</th>
              <th className="px-4 py-3 text-right">QS updated</th>
              <th className="px-4 py-3">Model</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {syncRuns.map((run) => (
              <tr
                key={run.sync_run_id}
                className={isBaselineSyncRun(run) ? 'bg-indigo-50/40 hover:bg-indigo-50/70' : 'hover:bg-slate-50/80'}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                  {formatWhen(run.completed_at || run.started_at)}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{syncRunLabel(run)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{run.trees_changed ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{run.qs_updated ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{run.model_version ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function HistoryReportPage() {
  const [scope, setScope] = useState(/** @type {'district' | 'quarter_section'} */ ('district'))
  const [district, setDistrict] = useState('')
  const [qsId, setQsId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const configured = Boolean(mapApiEnv.priorityHistoryUrl)
  const { data, isLoading, isFetching, error, refetch } = usePriorityHistory({
    priorityHistoryUrl: mapApiEnv.priorityHistoryUrl,
    scope,
    qsId: scope === 'quarter_section' ? qsId : null,
    district: district || null,
    fromDate: fromDate || null,
    toDate: toDate || null,
  })

  const { data: summaryFeatures = [] } = useSummariesFeaturesQuery()

  const districtOptions = useMemo(() => {
    const fromApi = Array.isArray(data?.districts) ? data.districts : []
    const fromSummaries = new Set()
    for (const f of summaryFeatures) {
      const d = f?.properties?.district
      if (d != null && String(d).trim() && !isUnknownDistrict(d)) fromSummaries.add(String(d).trim())
    }
    const merged = new Set([...fromApi, ...fromSummaries])
    return [...merged].filter((d) => d && !isUnknownDistrict(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [data?.districts, summaryFeatures])

  const qsOptions = useMemo(() => {
    const out = []
    for (const f of summaryFeatures) {
      const id = f?.properties?.qs_id ?? f?.properties?.QTRSEC
      if (id == null || !String(id).trim()) continue
      const qs = String(id).trim()
      const dist = f?.properties?.district != null ? String(f.properties.district) : ''
      out.push({ value: qs, label: dist ? `QS ${qs} (District ${dist})` : `QS ${qs}` })
    }
    out.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
    return out
  }, [summaryFeatures])

  const series = Array.isArray(data?.series) ? data.series : []
  const syncRuns = Array.isArray(data?.sync_runs) ? data.sync_runs : []
  const movers = Array.isArray(data?.movers) ? data.movers : []
  const metricTrends = Array.isArray(data?.metric_trends) ? data.metric_trends : []

  const chartSeries = useMemo(() => {
    let filtered = series
    if (scope === 'district') {
      filtered = series.filter((s) => !isUnknownDistrict(s.id) && !isUnknownDistrict(s.district))
    }
    if (scope === 'quarter_section' && !qsId.trim()) {
      if (movers.length > 0) {
        const topIds = new Set(movers.slice(0, 5).map((m) => m.id))
        return filtered.filter((s) => topIds.has(s.id))
      }
      return filtered.slice(0, 8)
    }
    return filtered
  }, [scope, qsId, series, movers])

  const chartTimeScale = useMemo(() => {
    const times = chartSeries.flatMap((s) => collectRecordedAtMs(s.points))
    return buildTimeScale(times)
  }, [chartSeries])

  const chartScatterSeries = useMemo(
    () =>
      chartSeries.map((s, i) => ({
        id: s.id,
        name: s.label || s.id,
        data: priorityPointsToLineData(s.points, chartTimeScale),
        color: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [chartSeries, chartTimeScale],
  )

  const hasChartData = chartScatterSeries.some((s) => s.data.length > 0)
  const syncCount = syncRuns.length
  const loading = isLoading || isFetching

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 font-body text-slate-900">
      <AppNavbar />
      <div className="mt-16 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <main className="mx-auto max-w-6xl px-6 py-8 pb-12">
          <header>
            <h1 className="text-2xl font-bold">Priority Score History</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Track average tree priority score (0–1) by quarter section or district over TreeKeeper
              syncs. History updates every two days as new sync runs complete.
            </p>
          </header>

          {!configured ? (
            <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              Set <code className="text-xs">VITE_CF_GET_PRIORITY_HISTORY_URL</code> in your frontend env and deploy{' '}
              <code className="text-xs">getPriorityHistory</code> to load history data.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">View</span>
              <div className="flex flex-wrap gap-2">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                      scope === opt.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    onClick={() => setScope(/** @type {'district' | 'quarter_section'} */ (opt.id))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="min-w-[160px] space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">District</span>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">All districts</option>
                {districtOptions.map((d) => (
                  <option key={d} value={d}>
                    District {d}
                  </option>
                ))}
              </select>
            </label>

            {scope === 'quarter_section' ? (
              <label className="min-w-[220px] space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Quarter section
                </span>
                <input
                  list="history-qs-options"
                  value={qsId}
                  onChange={(e) => setQsId(e.target.value)}
                  placeholder="QS id (optional)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <datalist id="history-qs-options">
                  {qsOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </datalist>
              </label>
            ) : null}

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </label>

            <button
              type="button"
              className="ml-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm"
              onClick={() => refetch()}
              disabled={!configured || loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error instanceof Error ? error.message : String(error)}
            </p>
          ) : null}

          {data ? (
            <div className="mt-6 space-y-8">
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Successful syncs</p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{syncCount}</p>
                  <p className="mt-1 text-xs text-slate-500">Includes initial inventory load and TreeKeeper syncs</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {scope === 'district' ? 'Districts tracked' : 'Quarter sections tracked'}
                  </p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{chartSeries.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Matching current filters</p>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-sm font-bold text-slate-800">Average tree priority score over time</h2>
                  <p className="text-xs text-slate-500">
                    {scope === 'district'
                      ? 'Mean tree priority score (0–1) across all trees in each district'
                      : qsId.trim()
                        ? `Mean tree priority score for QS ${qsId.trim()}`
                        : 'Top movers by average score change (select a QS for detail)'}
                  </p>
                </div>

                {!hasChartData ? (
                  <p className="py-12 text-center text-sm text-slate-500">No history rows match these filters.</p>
                ) : (
                  <div className="h-[360px] w-full min-w-0">
                    <ChartSizeContainer>
                      {(size) => (
                        <HistoryTimeSeriesChart
                          width={size.width}
                          height={size.height}
                          series={chartScatterSeries}
                          timeScale={chartTimeScale}
                          showLegend={chartScatterSeries.length > 1}
                          showXLabel
                          yRange={{ min: 0, max: 1, pad: 0 }}
                          yAxisLabel="Avg tree PS (0–1)"
                        />
                      )}
                    </ChartSizeContainer>
                  </div>
                )}
              </section>

              {scope === 'quarter_section' && metricTrends.length > 0 ? (
                <section className="space-y-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">Inventory metrics over time</h2>
                    <p className="text-xs text-slate-500">
                      {qsId.trim()
                        ? `Average tree attributes for QS ${qsId.trim()} at each sync point`
                        : 'Average tree attributes across filtered quarter sections at each sync point'}
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {metricTrends.map((metric) => (
                      <MetricTrendChart key={metric.id} metric={metric} />
                    ))}
                  </div>
                </section>
              ) : null}

              {scope === 'quarter_section' && movers.length > 0 ? (
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-sm font-bold text-slate-800">Largest score changes</h2>
                    <p className="text-xs text-slate-500">
                      Quarter sections with the biggest shift between the two most recent sync points
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                      <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-4 py-3">QS</th>
                          <th className="px-4 py-3">District</th>
                          <th className="px-4 py-3 text-right">Previous</th>
                          <th className="px-4 py-3 text-right">Latest</th>
                          <th className="px-4 py-3 text-right">Change</th>
                          <th className="px-4 py-3">Latest sync</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {movers.map((row) => (
                          <tr
                            key={row.id}
                            className="cursor-pointer hover:bg-indigo-50/50"
                            onClick={() => setQsId(String(row.id))}
                          >
                            <td className="px-4 py-2.5 font-semibold text-indigo-700">{row.id}</td>
                            <td className="px-4 py-2.5">{row.district}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              {formatScore(row.prev_score)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              {formatScore(row.latest_score)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                                row.delta > 0 ? 'text-red-600' : row.delta < 0 ? 'text-emerald-600' : 'text-slate-600'
                              }`}
                            >
                              {formatDelta(row.delta)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                              {formatWhen(row.recorded_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <SyncRunsTable syncRuns={syncRuns} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
