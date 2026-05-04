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

/** @param {unknown} xLabel */
function parseXNumeric(xLabel) {
  if (xLabel == null) return NaN
  const n = Number(String(xLabel).replace(/,/g, '').trim())
  return n
}

/**
 * @param {Array<{ xLabel: unknown }>} rows
 */
function sortCartesianRows(rows) {
  if (!rows.length) return rows
  const allNumericX = rows.every((r) => Number.isFinite(parseXNumeric(r.xLabel)))
  const out = [...rows]
  if (allNumericX) {
    out.sort((a, b) => parseXNumeric(a.xLabel) - parseXNumeric(b.xLabel))
  } else {
    out.sort((a, b) => String(a.xLabel).localeCompare(String(b.xLabel)))
  }
  return out
}

/**
 * Least-squares line y = slope * x + intercept; returns R² on the points used.
 * @param {Array<{ x: number, y: number }>} points
 */
function linearRegression(points) {
  const n = points.length
  if (n < 2) return null
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const p of points) {
    sumX += p.x
    sumY += p.y
    sumXY += p.x * p.y
    sumXX += p.x * p.x
  }
  const den = n * sumXX - sumX * sumX
  if (Math.abs(den) < 1e-15) return null
  const slope = (n * sumXY - sumX * sumY) / den
  const intercept = (sumY - slope * sumX) / n
  const yMean = sumY / n
  let ssTot = 0
  let ssRes = 0
  for (const p of points) {
    const yhat = slope * p.x + intercept
    ssRes += (p.y - yhat) ** 2
    ssTot += (p.y - yMean) ** 2
  }
  const r2 = ssTot < 1e-15 ? (ssRes < 1e-15 ? 1 : 0) : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

/**
 * @param {Array<{ xLabel: unknown, yValue: number }>} rows
 */
function regressionFromXYRows(rows) {
  /** @type {Array<{ x: number, y: number }>} */
  const pts = []
  for (const r of rows) {
    const x = parseXNumeric(r.xLabel)
    const y = r.yValue
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y })
  }
  return linearRegression(pts)
}

/** @param {number} n */
function formatCoeff(n) {
  if (!Number.isFinite(n)) return '0'
  const a = Math.abs(n)
  if (a >= 1e4 || (a > 0 && a < 1e-3)) return n.toExponential(3)
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '')
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
    return {
      data: /** @type {Record<string, unknown>[]} */ (sortCartesianRows(rows)),
      seriesKeys: [],
      isMultiSeries: false,
    }
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
  const data = sortCartesianRows([...byX.values()])
  return { data, seriesKeys, isMultiSeries: true }
}

/**
 * @param {object} props
 * @param {'bar' | 'line' | 'pie' | 'scatter' | 'histogram'} props.chartType
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} props.rows
 * @param {string} props.xAxisTitle
 * @param {string} props.yAxisTitle
 */
export function ChartPreview({ chartType, rows, xAxisTitle, yAxisTitle }) {
  const cartesian = useMemo(() => prepareCartesianChartData(rows), [rows])
  const lineTrend = useMemo(() => {
    if (chartType !== 'line') return { data: null, caption: null }
    const { data, isMultiSeries } = cartesian
    if (isMultiSeries || data.length < 2) return { data: null, caption: null }
    const reg = regressionFromXYRows(
      /** @type {Array<{ xLabel: unknown, yValue: number }>} */ (data),
    )
    if (!reg) return { data: null, caption: null }
    const b = reg.intercept
    const bPart = b >= 0 ? `+ ${formatCoeff(b)}` : `- ${formatCoeff(Math.abs(b))}`
    const caption = {
      equation: `y = ${formatCoeff(reg.slope)}x ${bPart}`,
      r2: reg.r2.toFixed(4),
    }
    const withTrend = data.map((r) => {
      const xv = parseXNumeric(r.xLabel)
      const yhat = Number.isFinite(xv) ? reg.slope * xv + reg.intercept : NaN
      return { ...r, trendY: Number.isFinite(yhat) ? yhat : undefined }
    })
    return { data: withTrend, caption }
  }, [chartType, cartesian])

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

  if (chartType === 'histogram') {
    const values = rows.map((r) => Number(r.yValue)).filter((v) => Number.isFinite(v))
    if (!values.length) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const bins = Math.min(14, Math.max(6, Math.round(Math.sqrt(values.length))))
    const width = max > min ? (max - min) / bins : 1
    const hist = Array.from({ length: bins }, (_, i) => {
      const lo = min + i * width
      const hi = i === bins - 1 ? max : lo + width
      return { xLabel: `${lo.toFixed(1)}-${hi.toFixed(1)}`, yValue: 0 }
    })
    for (const v of values) {
      const idx = max > min ? Math.min(bins - 1, Math.floor((v - min) / width)) : 0
      hist[idx].yValue += 1
    }
    const xLabel = measureName
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <ResponsiveContainer width="100%" height="100%" className="h-full min-h-0 min-w-0 w-full">
          <BarChart data={hist} margin={chartAxisMarginLeftLabeled}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e9ec" />
            <XAxis
              dataKey="xLabel"
              tick={{ fontSize: 10 }}
              stroke="#737c7f"
              label={{ value: xLabel, position: 'insideBottom', offset: -18, ...AXIS_TITLE_LABEL_STYLE }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={yAxisTickWidth}
              stroke="#737c7f"
              allowDecimals={false}
              label={yAxisTitleLabelProps('Frequency')}
            />
            <Tooltip formatter={(v) => [v, 'Count']} separator=": " />
            <Bar dataKey="yValue" fill={CHART_STROKE} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chartType === 'line') {
    const { seriesKeys, isMultiSeries } = cartesian
    const data = lineTrend.data ?? cartesian.data
    const trendCaption = !isMultiSeries ? lineTrend.caption : null
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
          {!isMultiSeries && lineTrend.data ? (
            <Line
              type="linear"
              dataKey="trendY"
              name="Least squares"
              stroke="#c62828"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
        </LineChart>
        </ResponsiveContainer>
        {trendCaption ? (
          <div className="mt-2 shrink-0 space-y-0.5 px-2 text-center text-[11px] leading-snug text-slate-600">
            <div className="font-mono tabular-nums">{trendCaption.equation}</div>
            <div>
              R<sup>2</sup> = {trendCaption.r2}
            </div>
          </div>
        ) : null}
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
