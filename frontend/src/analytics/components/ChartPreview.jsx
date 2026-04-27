import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const CHART_STROKE = '#4c56af'
const PIE_COLORS = ['#4c56af', '#6b7ae8', '#8b93c4', '#a8afd9', '#c5cae8']
const SERIES_COLORS = PIE_COLORS
const chartAxisMarginLeftLabeled = { top: 20, right: 30, bottom: 28, left: 10 }
const yAxisTickWidth = 72
const AXIS_TITLE_LABEL_STYLE = { fill: '#737c7f', fontSize: 11, fontWeight: 'bold' }

/** Extra bottom SVG room when bar/line show a multi-series Legend (matches `<Legend />` mount). */
function barLineChartMargin(showLegend) {
  return { ...chartAxisMarginLeftLabeled, bottom: showLegend ? 72 : 28 }
}

/** X dimension title under ticks; tighter offset when legend reserves lower band. */
function buildXAxisDimensionTitleProps(xAxisTitle, showLegend) {
  if (!xAxisTitle) return {}
  return {
    label: {
      value: xAxisTitle,
      position: 'insideBottom',
      offset: showLegend ? -12 : -18,
      ...AXIS_TITLE_LABEL_STYLE,
    },
  }
}

const legendBottomWrapperStyle = { fontSize: 11, paddingTop: 12, paddingBottom: 4 }

/** @param {unknown} value */
function formatTooltipNumber(value) {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return value
  return value.toFixed(2)
}

/** @param {unknown} value */
function formatAxisTick(value) {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return ''
  return value.toFixed(2)
}

/** Human-readable Y series name for tooltips (avoids showing raw `yValue` dataKey). */
function measureDisplayName(yAxisTitle) {
  const t = String(yAxisTitle ?? '').trim()
  return t || 'Value'
}

/**
 * Recharts Y-axis title: SVG text needs middle anchoring when rotated -90deg.
 * @param {string} title
 */
function yAxisTitleLabelProps(title) {
  return {
    value: title,
    angle: -90,
    position: 'insideLeft',
    offset: 16,
    style: {
      fill: '#737c7f',
      fontSize: 11,
      fontWeight: 'bold',
      textAnchor: 'middle',
      dominantBaseline: 'central',
    },
  }
}

/**
 * Pie: one slice per primary X dimension value; sum y when duplicates exist. Ignores `series`.
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} rows
 * @returns {{ name: string, value: number }[]}
 */
function buildPieData(rows) {
  /** @type {Map<string, number>} */
  const byName = new Map()
  for (const r of rows) {
    if (!Number.isFinite(r.yValue)) continue
    const x = String(r.xLabel ?? '').trim()
    if (!x) continue
    byName.set(x, (byName.get(x) ?? 0) + r.yValue)
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value }))
}

/**
 * Long-form rows → wide objects for grouped bar/line when `series` is set.
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} rows
 * @returns {{ data: Record<string, unknown>[], seriesKeys: string[], isMultiSeries: boolean }}
 */
function prepareCartesianChartData(rows) {
  const hasSeries = rows.some((r) => r.series != null && String(r.series).trim() !== '')
  if (!hasSeries) {
    return { data: /** @type {Record<string, unknown>[]} */ (rows), seriesKeys: [], isMultiSeries: false }
  }
  /** @type {Set<string>} */
  const seriesSet = new Set()
  for (const r of rows) {
    seriesSet.add(String(r.series ?? '').trim() || 'Unknown')
  }
  const seriesKeys = [...seriesSet].sort((a, b) => a.localeCompare(b))
  /** @type {Map<string, Record<string, unknown>>} */
  const byX = new Map()
  for (const r of rows) {
    const x = r.xLabel
    const s = String(r.series ?? '').trim() || 'Unknown'
    let row = byX.get(x)
    if (!row) {
      row = { xLabel: x }
      for (const k of seriesKeys) {
        row[k] = 0
      }
      byX.set(x, row)
    }
    const prev = typeof row[s] === 'number' ? row[s] : 0
    row[s] = prev + (Number.isFinite(r.yValue) ? r.yValue : 0)
  }
  const data = [...byX.values()].sort((a, b) => String(a.xLabel).localeCompare(String(b.xLabel)))
  return { data, seriesKeys, isMultiSeries: true }
}

/**
 * @param {object} props
 * @param {'bar' | 'line' | 'pie' | 'scatter'} props.chartType
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} props.rows
 * @param {string} props.xAxisTitle
 * @param {string} props.yAxisTitle
 */
export function ChartPreview({ chartType, rows, xAxisTitle, yAxisTitle }) {
  const cartesian = useMemo(() => prepareCartesianChartData(rows), [rows])

  if (!rows.length) return null

  const measureName = measureDisplayName(yAxisTitle)
  const yLabelProp = yAxisTitle ? { label: yAxisTitleLabelProps(yAxisTitle) } : {}

  if (chartType === 'pie') {
    const pieData = buildPieData(rows).map((d) => ({ name: d.name, value: Number(d.value) }))
    const caption =
      xAxisTitle && yAxisTitle ? `${xAxisTitle} · ${yAxisTitle}` : xAxisTitle || yAxisTitle || 'Distribution'
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <p className="mb-1 shrink-0 truncate px-1 text-center text-[11px] font-bold text-on-surface-variant">{caption}</p>
        <div className="min-h-0 min-w-0 flex-1">
          {pieData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center px-4 text-center text-sm text-on-surface-variant">
              No valid slices for this chart (check for empty labels or non-numeric values).
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" className="h-full min-h-0 min-w-0 w-full">
              <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Tooltip formatter={(value) => [formatTooltipNumber(value), measureName]} separator=": " />
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={0}
                  outerRadius={108}
                  paddingAngle={1}
                  fill={CHART_STROKE}
                  isAnimationActive={false}
                >
                  {pieData.map((slice, i) => (
                    <Cell key={`${slice.name}-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    )
  }

  if (chartType === 'scatter') {
    const scatterData = rows.map((r, i) => ({
      x: i + 1,
      y: r.yValue,
      label: r.xLabel,
      series: r.series != null && String(r.series).trim() !== '' ? String(r.series) : undefined,
    }))
    const xScatterTitle = xAxisTitle || 'Category order'
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <ResponsiveContainer width="100%" height="100%" className="h-full min-h-0 min-w-0 w-full">
        <ScatterChart margin={chartAxisMarginLeftLabeled}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e9ec" />
          <XAxis
            type="number"
            dataKey="x"
            stroke="#737c7f"
            fontSize={12}
            label={{ value: xScatterTitle, position: 'insideBottom', offset: -18, fill: '#737c7f', fontSize: 11, fontWeight: 'bold' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            width={yAxisTickWidth}
            stroke="#737c7f"
            fontSize={12}
            tickFormatter={formatAxisTick}
            {...yLabelProp}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            formatter={(v) => [formatTooltipNumber(v), measureName]}
            labelFormatter={(_label, payload) => {
              const pt = Array.isArray(payload) ? payload[0]?.payload : null
              const base = pt?.label != null ? String(pt.label) : ''
              const ser = pt?.series
              return ser ? `${base} (${ser})` : base
            }}
            separator=": "
          />
          <Scatter data={scatterData} fill={CHART_STROKE} />
        </ScatterChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chartType === 'line') {
    const { data, seriesKeys, isMultiSeries } = cartesian
    const showLegend = isMultiSeries
    const margin = barLineChartMargin(showLegend)
    const xDimTitleProp = buildXAxisDimensionTitleProps(xAxisTitle, showLegend)
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <ResponsiveContainer width="100%" height="100%" className="h-full min-h-0 min-w-0 w-full">
        <LineChart data={data} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e9ec" />
          <XAxis dataKey="xLabel" tick={{ fontSize: 11 }} stroke="#737c7f" {...xDimTitleProp} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={yAxisTickWidth}
            stroke="#737c7f"
            tickFormatter={formatAxisTick}
            {...yLabelProp}
          />
          <Tooltip
            formatter={(value, name) => [formatTooltipNumber(value), isMultiSeries ? String(name) : measureName]}
            labelFormatter={(_label, payload) => {
              const row = Array.isArray(payload) ? payload[0]?.payload : null
              return String(row?.xLabel ?? '')
            }}
            separator=": "
          />
          {isMultiSeries ? (
            <Legend verticalAlign="bottom" align="center" wrapperStyle={legendBottomWrapperStyle} />
          ) : null}
          {isMultiSeries
            ? seriesKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  isAnimationActive={false}
                />
              ))
            : (
                <Line type="monotone" dataKey="yValue" stroke={CHART_STROKE} strokeWidth={2} dot={{ r: 3, fill: CHART_STROKE }} />
              )}
        </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const { data, seriesKeys, isMultiSeries } = cartesian
  const showLegend = isMultiSeries
  const margin = barLineChartMargin(showLegend)
  const xDimTitleProp = buildXAxisDimensionTitleProps(xAxisTitle, showLegend)
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ResponsiveContainer width="100%" height="100%" className="h-full min-h-0 min-w-0 w-full">
      <BarChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e9ec" />
        <XAxis dataKey="xLabel" tick={{ fontSize: 11 }} stroke="#737c7f" {...xDimTitleProp} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={yAxisTickWidth}
          stroke="#737c7f"
          tickFormatter={formatAxisTick}
          {...yLabelProp}
        />
        <Tooltip
          formatter={(value, name) => [formatTooltipNumber(value), isMultiSeries ? String(name) : measureName]}
          labelFormatter={(_label, payload) => {
            const row = Array.isArray(payload) ? payload[0]?.payload : null
            return String(row?.xLabel ?? '')
          }}
          separator=": "
        />
        {isMultiSeries ? (
          <Legend verticalAlign="bottom" align="center" wrapperStyle={legendBottomWrapperStyle} />
        ) : null}
        {isMultiSeries
          ? seriesKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ))
          : (
              <Bar dataKey="yValue" fill={CHART_STROKE} radius={[4, 4, 0, 0]} />
            )}
      </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
