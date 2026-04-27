import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import AppNavbar from '../components/AppNavbar.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'
import { useAnalyticsDraftStore, migrateLegacyAnalyticsSnapshot, clearAnalyticsDraftStorage } from '../analytics/analyticsStore.js'
import { isDraftRunnable } from '../analytics/draftSerialize.js'
import { allowedChartTypes, chartDisabledReason, pickLegalChartType } from '../analytics/chartRules.js'
import { useRunAnalyticsMutation, useSummariesFeaturesQuery } from '../analytics/useAnalyticsData.js'
import { useAnalyticsSchemaQuery } from '../analytics/useAnalyticsSchemaQuery.js'
import { DataDictionaryPane } from '../analytics/panes/DataDictionaryPane.jsx'
import { BuilderPane } from '../analytics/panes/BuilderPane.jsx'
import { CanvasPane } from '../analytics/panes/CanvasPane.jsx'
import { PantryDragPreview } from '../analytics/components/PantryDragPreview.jsx'
import { escapeCsvCell } from '../analytics/csvUtils.js'

/**
 * @param {'x' | 'y' | 'color' | 'filters'} zone
 * @param {{ type: string } | null} variable
 */
function zoneAcceptsVariable(zone, variable) {
  if (!variable) return false
  if (zone === 'x' || zone === 'color') return variable.type === 'dimension'
  if (zone === 'y') return variable.type === 'measure'
  if (zone === 'filters') return true
  return false
}

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth()

  const canvasSectionRef = useRef(/** @type {HTMLElement | null} */ (null))
  const [dragActive, setDragActive] = useState(false)
  const [activePantryVariable, setActivePantryVariable] = useState(
    /** @type {{ id: string, name: string, type: 'dimension' | 'measure' } | null} */ (null),
  )
  const [lastResult, setLastResult] = useState(/** @type {{ rows: { xLabel: string, yValue: number, series?: string }[]; source: string } | null} */ (null))

  const dimensions = useAnalyticsDraftStore((s) => s.dimensions)
  const measures = useAnalyticsDraftStore((s) => s.measures)
  const searchTerm = useAnalyticsDraftStore((s) => s.searchTerm)
  const xAxisItem = useAnalyticsDraftStore((s) => s.xAxisItem)
  const yAxisItem = useAnalyticsDraftStore((s) => s.yAxisItem)
  const yAggregation = useAnalyticsDraftStore((s) => s.yAggregation)
  const colorItem = useAnalyticsDraftStore((s) => s.colorItem)
  const filterItems = useAnalyticsDraftStore((s) => s.filterItems)
  const draftFilters = useAnalyticsDraftStore((s) => s.draftFilters)
  const chartType = useAnalyticsDraftStore((s) => s.chartType)

  const setSearchTerm = useAnalyticsDraftStore((s) => s.setSearchTerm)
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
  const addDimension = useAnalyticsDraftStore((s) => s.addDimension)
  const addMeasure = useAnalyticsDraftStore((s) => s.addMeasure)
  const resetDraft = useAnalyticsDraftStore((s) => s.resetDraft)

  const featuresQuery = useSummariesFeaturesQuery()
  const schemaQuery = useAnalyticsSchemaQuery()
  const loadError = featuresQuery.error ? String(featuresQuery.error.message) : ''
  const schemaStatus =
    schemaQuery.isSuccess && schemaQuery.data
      ? `Schema endpoint: ${Array.isArray(schemaQuery.data?.dimensions) ? schemaQuery.data.dimensions.length : 0} dims`
      : schemaQuery.isError
        ? `Schema: ${String(schemaQuery.error?.message ?? schemaQuery.error)}`
        : ''

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = useCallback((event) => {
    setDragActive(true)
    const v = event.active.data.current?.variable
    setActivePantryVariable(v && typeof v === 'object' && 'id' in v && 'type' in v ? v : null)
  }, [])

  const handleDragCancel = useCallback(() => {
    setDragActive(false)
    setActivePantryVariable(null)
  }, [])

  const handleDragEnd = useCallback(
    (event) => {
      setDragActive(false)
      setActivePantryVariable(null)
      const { active, over } = event
      if (!over?.data?.current?.zone) return
      const zone = /** @type {'x'|'y'|'color'|'filters'} */ (over.data.current.zone)
      const variable = active.data.current?.variable
      if (!variable || !zoneAcceptsVariable(zone, variable)) return
      if (zone === 'filters') {
        addFilterVariable(variable)
        return
      }
      if (zone === 'x') setXAxisItem(variable)
      if (zone === 'y') setYAxisItem(variable)
      if (zone === 'color') setColorItem(variable)
    },
    [addFilterVariable, setXAxisItem, setYAxisItem, setColorItem],
  )

  const filteredDimensions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return dimensions
    return dimensions.filter((d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))
  }, [dimensions, searchTerm])

  const filteredMeasures = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return measures
    return measures.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [measures, searchTerm])

  const runnable = useMemo(() => isDraftRunnable({ xAxisItem, yAxisItem, yAggregation, colorItem }), [xAxisItem, yAxisItem, yAggregation, colorItem])

  const allowedCharts = useMemo(() => allowedChartTypes({ xAxisItem, yAxisItem, colorItem }), [xAxisItem, yAxisItem, colorItem])

  const reasonForChartType = useCallback((t) => chartDisabledReason(t, allowedCharts), [allowedCharts])

  const onRunQuery = useCallback(() => {
    const feats = featuresQuery.data ?? []
    runMutation.mutate(
      { features: feats },
      {
        onSuccess: (data) => {
          setLastResult(data)
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

  const onAddDimension = useCallback(() => {
    const name = window.prompt('Name for new dimension:')
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    addDimension(trimmed)
  }, [addDimension])

  const onAddMeasure = useCallback(() => {
    const name = window.prompt('Name for new measure:')
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    addMeasure(trimmed)
  }, [addMeasure])

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface text-on-surface">
      <AppNavbar />

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <main className="relative mt-16 flex h-[calc(100vh-4rem)] min-h-0 w-full overflow-hidden">
          <div className="flex h-full min-h-0 w-full flex-1">
            <DataDictionaryPane
              searchTerm={searchTerm}
              onSearchTerm={setSearchTerm}
              filteredDimensions={filteredDimensions}
              filteredMeasures={filteredMeasures}
              onAddDimension={onAddDimension}
              onAddMeasure={onAddMeasure}
              schemaStatus={mapApiEnv.analyticsSchemaUrl ? schemaStatus : ''}
            />
            <BuilderPane
              dragActive={dragActive}
              xAxisItem={xAxisItem}
              yAxisItem={yAxisItem}
              yAggregation={yAggregation}
              onYAggregation={setYAggregation}
              colorItem={colorItem}
              filterItems={filterItems}
              draftFilters={draftFilters}
              onUpdateDraftFilter={updateDraftFilter}
              onClearX={clearX}
              onClearY={clearY}
              onClearColor={clearColor}
              onRemoveFilter={removeFilterVariable}
              canRun={runnable && !featuresQuery.isLoading && Boolean(featuresQuery.data)}
              runBusy={runMutation.isPending}
              onRunQuery={onRunQuery}
            />
            <CanvasPane
              canvasSectionRef={canvasSectionRef}
              hasResult={Boolean(lastResult?.rows?.length)}
              rows={lastResult?.rows ?? []}
              chartType={chartType}
              onChartType={setChartType}
              allowedChartTypes={allowedCharts}
              chartDisabledReason={reasonForChartType}
              xAxisTitle={xAxisItem?.name ?? ''}
              yAxisTitle={yAxisItem ? `${yAxisItem.name} (${yAggregation})` : ''}
              loadError={featuresQuery.isError ? loadError : mapApiEnv.summariesUrl ? '' : 'Missing summaries API URL.'}
              runError={runMutation.isError ? String(runMutation.error?.message ?? runMutation.error) : ''}
              onReset={resetGraph}
              onFullscreen={toggleCanvasFullscreen}
              onExportCsv={exportCsv}
              exportDisabled={!lastResult?.rows?.length}
            />
          </div>
        </main>
        <DragOverlay dropAnimation={null} className="z-[10000]" style={{ cursor: 'grabbing' }}>
          {activePantryVariable ? <PantryDragPreview variable={activePantryVariable} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
