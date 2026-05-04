import { useState } from 'react'
import { ChartPreview } from '../components/ChartPreview.jsx'

const chartToggleActive =
  'flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-1.5 text-[10px] font-bold text-on-primary transition-all'
const chartToggleIdle =
  'flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-[10px] font-bold text-on-surface-variant transition-all hover:bg-surface-container-high'

const canvasScrollArea =
  'min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

const tableScrollAreaNoScrollbar =
  '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'

/** Inset inside chart card: horizontal + bottom uniform; extra top for floating chart-type toolbar. */
const chartCardContentInset = 'px-4 pb-4 pt-14'

/**
 * @param {unknown} v
 */
function formatTableYValue(v) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

/**
 * @param {object} props
 * @param {import('../types.js').ChartType} props.t
 * @param {string} props.icon
 * @param {string} props.label
 * @param {import('../types.js').ChartType} props.chartType
 * @param {(t: import('../types.js').ChartType) => void} props.onChartType
 * @param {import('../types.js').ChartType[]} props.allowedChartTypes
 * @param {(t: import('../types.js').ChartType) => string | undefined} props.chartDisabledReason
 */
function ChartToggleButton({ t, icon, label, chartType, onChartType, allowedChartTypes, chartDisabledReason }) {
  const allowed = allowedChartTypes.includes(t)
  const reason = chartDisabledReason(t)
  return (
    <button
      type="button"
      disabled={!allowed}
      title={allowed ? label : reason}
      className={chartType === t ? chartToggleActive : chartToggleIdle}
      onClick={() => allowed && onChartType(t)}
    >
      <span className="material-symbols-outlined shrink-0 text-base">{icon}</span>
      {label}
    </button>
  )
}

/**
 * @param {object} props
 * @param {import('react').MutableRefObject<HTMLElement | null>} props.canvasSectionRef
 * @param {boolean} props.hasResult
 * @param {Array<{ xLabel: string, yValue: number, series?: string }>} props.rows
 * @param {import('../types.js').ChartType} props.chartType
 * @param {(t: import('../types.js').ChartType) => void} props.onChartType
 * @param {import('../types.js').ChartType[]} props.allowedChartTypes
 * @param {(t: import('../types.js').ChartType) => string | undefined} props.chartDisabledReason
 * @param {string} props.xAxisTitle
 * @param {string} props.yAxisTitle
 * @param {string} props.loadError
 * @param {string} props.runError
 * @param {() => void} props.onReset
 * @param {() => void} props.onFullscreen
 * @param {() => void} props.onExportCsv
 * @param {boolean} props.exportDisabled
 * @param {{
 *   rowsReturned: number
 *   chartMaxPoints: number
 *   chartSampled: boolean
 *   chartOriginalCount: number
 * } | null | undefined} props.resultMeta
 */
export function CanvasPane({
  canvasSectionRef,
  hasResult,
  rows,
  chartType,
  onChartType,
  allowedChartTypes,
  chartDisabledReason,
  xAxisTitle,
  yAxisTitle,
  loadError,
  runError,
  onReset,
  onFullscreen,
  onExportCsv,
  exportDisabled,
  resultMeta = null,
}) {
  const [tableOpen, setTableOpen] = useState(false)

  return (
    <section
      ref={canvasSectionRef}
      className="relative flex min-h-0 w-[55%] min-w-0 flex-col overflow-hidden bg-surface-dim/30"
    >
      <div className={`${canvasScrollArea} flex flex-col`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch gap-4 px-4 py-6">
          <div
            className={
              hasResult
                ? 'relative flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl shadow-slate-900/5'
                : 'relative aspect-[16/10] w-full max-w-3xl min-h-[320px] max-h-[min(100%,520px)] shrink-0 self-center overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl shadow-slate-900/5'
            }
          >
            {!hasResult ? (
              <>
                <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_30%,#4c56af_0%,transparent_50%),radial-gradient(circle_at_80%_70%,#4c56af_0%,transparent_50%)] opacity-5" />
                <div className="relative z-0 flex min-h-[280px] flex-col items-center justify-center gap-4 px-6 text-center">
                  <span
                    className="material-symbols-outlined select-none text-primary"
                    style={{ fontSize: 48, width: 48, height: 48, lineHeight: 1 }}
                    aria-hidden
                  >
                    bar_chart
                  </span>
                  <div className="flex max-w-md flex-col items-center gap-2">
                    <h2 className="text-xl !font-bold !text-primary">Design Your Visualization</h2>
                    <p className="text-sm leading-relaxed text-slate-600">
                      {`Drag dimensions and measures from the data dictionary into the builder, then click 'Run Query' to generate your chart.`}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className={`flex h-[450px] w-full shrink-0 flex-col ${chartCardContentInset}`}>
                {resultMeta?.chartSampled ? (
                  <div className="mb-2 shrink-0 rounded-lg border border-amber-200/90 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-950">
                    <span>
                      Chart and table use {rows.length.toLocaleString()} of{' '}
                      {resultMeta.chartOriginalCount.toLocaleString()} points (browser cap ~{' '}
                      {resultMeta.chartMaxPoints.toLocaleString()}).
                    </span>
                  </div>
                ) : null}
                <div className="min-h-0 min-w-0 flex-1">
                  <ChartPreview chartType={chartType} rows={rows} xAxisTitle={xAxisTitle} yAxisTitle={yAxisTitle} />
                </div>
              </div>
            )}
          </div>

          {hasResult && rows.length > 0 ? (
            <div className="w-full min-w-0 shrink-0 rounded-xl border border-outline-variant/15 bg-surface-container-lowest">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-on-surface-variant"
                onClick={() => setTableOpen((o) => !o)}
              >
                <span>Data table</span>
                <span className="material-symbols-outlined text-base">{tableOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
              {tableOpen ? (
                <div className={`max-h-48 overflow-auto border-t border-outline-variant/10 ${tableScrollAreaNoScrollbar}`}>
                  <table className="w-full text-left text-[11px] text-on-surface">
                    <thead className="sticky top-0 bg-surface-container-lowest">
                      <tr className="border-b border-outline-variant/15">
                        <th className="px-2 py-1 font-semibold">{xAxisTitle || 'X'}</th>
                        <th className="px-2 py-1 font-semibold">{yAxisTitle || 'Y'}</th>
                        {rows.some((r) => r.series != null) ? (
                          <th className="px-2 py-1 font-semibold">Series</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.xLabel}-${i}`} className="border-b border-outline-variant/10">
                          <td className="px-2 py-1">{r.xLabel}</td>
                          <td className="px-2 py-1 tabular-nums">{formatTableYValue(r.yValue)}</td>
                          {rows.some((x) => x.series != null) ? <td className="px-2 py-1">{r.series ?? ''}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-6 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 justify-center">
        <div className="pointer-events-auto flex flex-nowrap items-center gap-0.5 overflow-x-auto rounded-full border border-outline-variant/15 bg-surface-container-lowest p-0.5 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ChartToggleButton
            t="bar"
            icon="bar_chart"
            label="Bar"
            chartType={chartType}
            onChartType={onChartType}
            allowedChartTypes={allowedChartTypes}
            chartDisabledReason={chartDisabledReason}
          />
          <ChartToggleButton
            t="line"
            icon="show_chart"
            label="Line"
            chartType={chartType}
            onChartType={onChartType}
            allowedChartTypes={allowedChartTypes}
            chartDisabledReason={chartDisabledReason}
          />
          <ChartToggleButton
            t="pie"
            icon="pie_chart"
            label="Pie"
            chartType={chartType}
            onChartType={onChartType}
            allowedChartTypes={allowedChartTypes}
            chartDisabledReason={chartDisabledReason}
          />
          <ChartToggleButton
            t="scatter"
            icon="scatter_plot"
            label="Scatter"
            chartType={chartType}
            onChartType={onChartType}
            allowedChartTypes={allowedChartTypes}
            chartDisabledReason={chartDisabledReason}
          />
          <ChartToggleButton
            t="histogram"
            icon="stacked_bar_chart"
            label="Histogram"
            chartType={chartType}
            onChartType={onChartType}
            allowedChartTypes={allowedChartTypes}
            chartDisabledReason={chartDisabledReason}
          />
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Reset draft"
            title="Start fresh"
            onClick={onReset}
          >
            <span className="material-symbols-outlined text-base">add</span>
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-end justify-between border-t border-outline-variant/10 bg-surface-dim/30 p-6">
        <div className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant opacity-60">Status</span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-on-surface">Engine Ready</span>
            </div>
            {loadError ? <span className="text-xs text-red-700">{loadError}</span> : null}
            {runError ? <span className="text-xs text-red-700">{runError}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-2 text-on-surface-variant transition-colors hover:text-primary"
            aria-label="Fullscreen"
            onClick={onFullscreen}
          >
            <span className="material-symbols-outlined text-lg">fullscreen</span>
          </button>
          <button
            type="button"
            className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-2 text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Download CSV"
            disabled={exportDisabled}
            onClick={onExportCsv}
          >
            <span className="material-symbols-outlined text-lg">download</span>
          </button>
        </div>
      </div>
    </section>
  )
}
