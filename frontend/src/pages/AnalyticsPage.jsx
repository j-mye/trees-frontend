import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppNavbar from '../components/AppNavbar.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'
import { useAnalyticsDraftStore, migrateLegacyAnalyticsSnapshot, clearAnalyticsDraftStorage } from '../analytics/analyticsStore.js'
import { isDraftRunnable } from '../analytics/draftSerialize.js'
import { allowedChartTypes, chartDisabledReason, pickLegalChartType } from '../analytics/chartRules.js'
import { useRunAnalyticsMutation, useSummariesFeaturesQuery } from '../analytics/useAnalyticsData.js'
import { BuilderPane } from '../analytics/panes/BuilderPane.jsx'
import { CanvasPane } from '../analytics/panes/CanvasPane.jsx'
import { escapeCsvCell } from '../analytics/csvUtils.js'
import { geoPropertyKeyForFieldId } from '../analytics/clientAggregate.js'
import { FILTER_DISTRICT_ID, FILTER_QUARTER_SECTION_ID } from '../analytics/fieldCatalog.js'
import { buildAnalyticsChartTitle } from '../analytics/chartTitle.js'
import { isUnknownCatalogValue, parseInFilterValues } from '../analytics/filterUtils.js'
import { quarterSectionIdFromProperties } from '../analytics/quarterSectionId.js'

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth()

  const canvasSectionRef = useRef(/** @type {HTMLElement | null} */ (null))
  const [infoOpen, setInfoOpen] = useState(false)
  const [lastResult, setLastResult] = useState(
    /** @type {{ rows: { xLabel: string, yValue: number, series?: string }[]; source: string; meta?: { rowsReturned: number; chartMaxPoints: number; chartSampled: boolean; chartOriginalCount: number } } | null} */ (
      null
    ),
  )
  const [runAttempted, setRunAttempted] = useState(false)

  const dimensions = useAnalyticsDraftStore((s) => s.dimensions)
  const measures = useAnalyticsDraftStore((s) => s.measures)
  const xAxisItem = useAnalyticsDraftStore((s) => s.xAxisItem)
  const yAxisItem = useAnalyticsDraftStore((s) => s.yAxisItem)
  const yAggregation = useAnalyticsDraftStore((s) => s.yAggregation)
  const colorItem = useAnalyticsDraftStore((s) => s.colorItem)
  const filterItems = useAnalyticsDraftStore((s) => s.filterItems)
  const draftFilters = useAnalyticsDraftStore((s) => s.draftFilters)
  const chartType = useAnalyticsDraftStore((s) => s.chartType)

  const setXAxisItem = useAnalyticsDraftStore((s) => s.setXAxisItem)
  const setYAxisItem = useAnalyticsDraftStore((s) => s.setYAxisItem)
  const setYAggregation = useAnalyticsDraftStore((s) => s.setYAggregation)
  const setColorItem = useAnalyticsDraftStore((s) => s.setColorItem)
  const setChartType = useAnalyticsDraftStore((s) => s.setChartType)
  const clearX = useAnalyticsDraftStore((s) => s.clearX)
  const clearY = useAnalyticsDraftStore((s) => s.clearY)
  const clearColor = useAnalyticsDraftStore((s) => s.clearColor)
  const addFilterVariable = useAnalyticsDraftStore((s) => s.addFilterVariable)
  const removeFilterVariable = useAnalyticsDraftStore((s) => s.removeFilterVariable)
  const updateDraftFilter = useAnalyticsDraftStore((s) => s.updateDraftFilter)
  const setInListFilter = useAnalyticsDraftStore((s) => s.setInListFilter)
  const resetDraft = useAnalyticsDraftStore((s) => s.resetDraft)

  const featuresQuery = useSummariesFeaturesQuery()
  const loadError = featuresQuery.error ? String(featuresQuery.error.message) : ''

  const getDraft = useCallback(
    () => ({
      xAxisItem,
      yAxisItem,
      yAggregation,
      colorItem,
      draftFilters,
      chartType,
    }),
    [xAxisItem, yAxisItem, yAggregation, colorItem, draftFilters, chartType],
  )

  const runMutation = useRunAnalyticsMutation({ getDraft })

  useEffect(() => {
    if (authLoading || !user?.uid) return
    migrateLegacyAnalyticsSnapshot(user.uid)
  }, [authLoading, user?.uid])

  const colorOptions = useMemo(
    () => [{ value: '', label: 'None' }, ...dimensions.map((d) => ({ value: d.id, label: d.name }))],
    [dimensions],
  )

  const quarterSectionOptions = useMemo(() => {
    const feats = featuresQuery.data ?? []
    const ids = new Set()
    for (const feat of feats) {
      const qs = quarterSectionIdFromProperties(feat?.properties)
      if (qs) ids.add(qs)
    }
    return [...ids].sort((a, b) => a.localeCompare(b)).map((id) => ({ value: id, label: id }))
  }, [featuresQuery.data])

  const districtOptions = useMemo(() => {
    const feats = featuresQuery.data ?? []
    const districts = new Set()
    for (const feat of feats) {
      const d = String(feat?.properties?.district ?? '').trim()
      if (d && !isUnknownCatalogValue(d)) districts.add(d)
    }
    return [...districts].sort((a, b) => a.localeCompare(b)).map((d) => ({ value: d, label: d }))
  }, [featuresQuery.data])

  const selectedQuarterSections = useMemo(
    () => parseInFilterValues(draftFilters, FILTER_QUARTER_SECTION_ID),
    [draftFilters],
  )

  const selectedDistricts = useMemo(
    () => parseInFilterValues(draftFilters, FILTER_DISTRICT_ID),
    [draftFilters],
  )

  const onQuarterSectionsChange = useCallback(
    (values) => setInListFilter(FILTER_QUARTER_SECTION_ID, values),
    [setInListFilter],
  )

  const onDistrictsChange = useCallback(
    (values) => setInListFilter(FILTER_DISTRICT_ID, values),
    [setInListFilter],
  )

  const filterValueOptionsByField = useMemo(() => {
    /** @type {Record<string, string[]>} */
    const out = {}
    const feats = featuresQuery.data ?? []
    for (const v of filterItems) {
      const key = geoPropertyKeyForFieldId(v.id)
      /** @type {Map<string, number>} */
      const counts = new Map()
      for (const feat of feats) {
        const p = feat?.properties ?? {}
        const raw = p && typeof p === 'object' ? p[key] : undefined
        const str = String(raw ?? '').trim()
        if (!str) continue
        counts.set(str, (counts.get(str) ?? 0) + 1)
      }
      out[v.id] = [...counts.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, 100)
        .map(([label]) => label)
    }
    return out
  }, [featuresQuery.data, filterItems])

  const onSelectColorId = useCallback(
    (id) => {
      if (!id) { clearColor(); return }
      const next = dimensions.find((d) => d.id === id) ?? null
      if (next) setColorItem(next)
    },
    [clearColor, dimensions, setColorItem],
  )

  const chartTitle = useMemo(
    () =>
      buildAnalyticsChartTitle({
        xAxisItem,
        yAxisItem,
        yAggregation,
        selectedQuarterSections,
        selectedDistricts,
      }),
    [xAxisItem, yAxisItem, yAggregation, selectedQuarterSections, selectedDistricts],
  )

  const runnable = useMemo(
    () => isDraftRunnable({ xAxisItem, yAxisItem, yAggregation, colorItem }),
    [xAxisItem, yAxisItem, yAggregation, colorItem],
  )

  const allowedCharts = useMemo(
    () => allowedChartTypes({ xAxisItem, yAxisItem, colorItem }),
    [xAxisItem, yAxisItem, colorItem],
  )

  const reasonForChartType = useCallback((t) => chartDisabledReason(t, allowedCharts), [allowedCharts])

  const onRunQuery = useCallback(() => {
    const feats = featuresQuery.data ?? []
    runMutation.mutate(
      { features: feats },
      {
        onSuccess: (data) => {
          setLastResult(data)
          setRunAttempted(true)
          const st = useAnalyticsDraftStore.getState()
          const allowed = allowedChartTypes({
            xAxisItem: st.xAxisItem,
            yAxisItem: st.yAxisItem,
            colorItem: st.colorItem,
          })
          const next = pickLegalChartType(st.chartType, allowed)
          if (next !== st.chartType) useAnalyticsDraftStore.getState().setChartType(next)
        },
      },
    )
  }, [featuresQuery.data, runMutation])

  const resetGraph = useCallback(() => {
    clearAnalyticsDraftStorage()
    resetDraft()
    setLastResult(null)
    setRunAttempted(false)
    runMutation.reset()
  }, [resetDraft, runMutation])

  const toggleCanvasFullscreen = useCallback(async () => {
    const el = canvasSectionRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch (err) {
      console.warn('Fullscreen request failed', err)
    }
  }, [])

  const exportCsv = useCallback(() => {
    const rows = lastResult?.rows ?? []
    if (!rows.length || !xAxisItem || !yAxisItem) return
    const headers = [xAxisItem.name, yAxisItem.name]
    if (rows.some((r) => r.series != null)) headers.push('Series')
    const lines = [headers.map(escapeCsvCell).join(',')]
    for (const row of rows) {
      const cells = [escapeCsvCell(row.xLabel), escapeCsvCell(row.yValue)]
      if (headers.includes('Series')) cells.push(escapeCsvCell(row.series ?? ''))
      lines.push(cells.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'analytics-export.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [lastResult, xAxisItem, yAxisItem])

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface text-on-surface">
      <AppNavbar />

      {infoOpen ? (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-on-surface">How Analytics Works</h2>
              <button
                type="button"
                aria-label="Close analytics info"
                className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                onClick={() => setInfoOpen(false)}
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="space-y-2 text-sm text-on-surface-variant">
              <p><strong className="text-on-surface">Quick Insights</strong>: click any tile on the left to instantly load a pre-built chart.</p>
              <p><strong className="text-on-surface">Custom Chart</strong>: choose a "Group by" category (e.g. Species or District) and a Measure (e.g. Tree Count), then click Generate Chart.</p>
              <p><strong className="text-on-surface">Aggregation</strong>: how the measure is combined within each group — SUM, AVG, MAX, or COUNT.</p>
              <p><strong className="text-on-surface">Color / Split by</strong>: choose a second dimension to break the chart into multiple series (e.g. Priority Level within each District).</p>
              <p><strong className="text-on-surface">Filters</strong>: narrow results to specific quarter sections, districts, or other field values.</p>
              <p><strong className="text-on-surface">Chart types</strong>: switch between Bar, Line, Pie, Scatter, and Histogram using the toolbar above the chart.</p>
              <p className="pt-1 text-xs">Charts are computed client-side from the same quarter-section summary data as the map — same source, instant results.</p>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary hover:opacity-95"
                onClick={() => setInfoOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="relative mt-16 flex h-[calc(100vh-4rem)] min-h-0 w-full overflow-hidden">
        <BuilderPane
          xAxisItem={xAxisItem}
          yAxisItem={yAxisItem}
          yAggregation={yAggregation}
          onSetX={setXAxisItem}
          onClearX={clearX}
          onSetY={setYAxisItem}
          onClearY={clearY}
          onYAggregation={setYAggregation}
          colorItem={colorItem}
          colorOptions={colorOptions}
          selectedColorId={colorItem?.id ?? ''}
          onSelectColorId={onSelectColorId}
          onClearColor={clearColor}
          filterItems={filterItems}
          draftFilters={draftFilters}
          onUpdateDraftFilter={updateDraftFilter}
          onRemoveFilter={removeFilterVariable}
          onAddFilterVariable={addFilterVariable}
          filterValueOptionsByField={filterValueOptionsByField}
          quarterSectionOptions={quarterSectionOptions}
          selectedQuarterSections={selectedQuarterSections}
          onQuarterSectionsChange={onQuarterSectionsChange}
          districtOptions={districtOptions}
          selectedDistricts={selectedDistricts}
          onDistrictsChange={onDistrictsChange}
          dimensions={dimensions}
          measures={measures}
          canRun={runnable && !featuresQuery.isLoading && Boolean(featuresQuery.data)}
          runBusy={runMutation.isPending}
          onRunQuery={onRunQuery}
          dataLoading={featuresQuery.isLoading}
        />
        <CanvasPane
          canvasSectionRef={canvasSectionRef}
          hasResult={Boolean(lastResult?.rows?.length)}
          rows={lastResult?.rows ?? []}
          resultMeta={lastResult?.meta ?? null}
          chartType={chartType}
          onChartType={setChartType}
          allowedChartTypes={allowedCharts}
          chartDisabledReason={reasonForChartType}
          chartTitle={chartTitle}
          xAxisTitle={xAxisItem?.name ?? ''}
          yAxisTitle={
            yAxisItem
              ? `${yAxisItem.name} (${yAggregation})`
              : ''
          }
          loadError={featuresQuery.isError ? loadError : mapApiEnv.summariesUrl ? '' : 'Missing summaries API URL.'}
          runError={runMutation.isError ? String(runMutation.error?.message ?? runMutation.error) : ''}
          onReset={resetGraph}
          onFullscreen={toggleCanvasFullscreen}
          onExportCsv={exportCsv}
          exportDisabled={!lastResult?.rows?.length}
          dataLoading={featuresQuery.isLoading}
          runAttempted={runAttempted}
          runIsEmpty={runAttempted && !lastResult?.rows?.length && !runMutation.isPending && !runMutation.isError}
        />
        <button
          type="button"
          aria-label="Open analytics help"
          title="How analytics works"
          className="absolute right-4 top-3 z-[90] flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant shadow hover:text-primary"
          onClick={() => setInfoOpen(true)}
        >
          <span className="material-symbols-outlined text-base">info</span>
        </button>
      </main>
    </div>
  )
}
