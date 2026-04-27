import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  CATALOG_DIMENSIONS,
  CATALOG_MEASURES,
  catalogFieldToVariable,
  defaultAggregationForMeasureId,
} from './fieldCatalog.js'
import { pickLegalChartType, allowedChartTypes } from './chartRules.js'
import { DRAFT_QUERY_VERSION } from './types.js'

/**
 * @typedef {import('./types.js').Variable} Variable
 * @typedef {import('./types.js').DraftFilter} DraftFilter
 * @typedef {import('./types.js').Aggregation} Aggregation
 * @typedef {import('./types.js').ChartType} ChartType
 */

const LEGACY_STORAGE_KEY = 'trees_analytics_builder_v1'
const PERSIST_NAME = 'trees-analytics-draft-v2'

function defaultDimensions() {
  return CATALOG_DIMENSIONS.map(catalogFieldToVariable)
}

function defaultMeasures() {
  return CATALOG_MEASURES.map(catalogFieldToVariable)
}

/**
 * @param {unknown} v
 * @returns {v is Variable}
 */
function isVariableShape(v) {
  return Boolean(v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && (v.type === 'dimension' || v.type === 'measure'))
}

/**
 * @param {Variable | null | undefined} v
 * @param {Variable[]} dimensions
 * @param {Variable[]} measures
 * @returns {Variable | null}
 */
export function variableInPool(v, dimensions, measures) {
  if (!isVariableShape(v)) return null
  if (v.type === 'dimension') return dimensions.find((d) => d.id === v.id) ?? null
  if (v.type === 'measure') return measures.find((m) => m.id === v.id) ?? null
  return null
}

/**
 * @param {Variable} v
 * @returns {DraftFilter}
 */
export function defaultDraftFilterForVariable(v) {
  const fromCat = [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES].find((c) => c.id === v.id)
  if (fromCat?.valueType === 'number') {
    return { fieldId: v.id, op: 'gte', value: '0' }
  }
  return { fieldId: v.id, op: 'eq', value: '' }
}

export const useAnalyticsDraftStore = create(
  persist(
    (set) => ({
      draftVersion: DRAFT_QUERY_VERSION,
      dimensions: defaultDimensions(),
      measures: defaultMeasures(),
      searchTerm: '',
      xAxisItem: /** @type {Variable | null} */ (null),
      yAxisItem: /** @type {Variable | null} */ (null),
      yAggregation: /** @type {Aggregation} */ ('SUM'),
      colorItem: /** @type {Variable | null} */ (null),
      filterItems: /** @type {Variable[]} */ ([]),
      draftFilters: /** @type {DraftFilter[]} */ ([]),
      chartType: /** @type {ChartType} */ ('bar'),

      setSearchTerm: (searchTerm) => set({ searchTerm }),
      setXAxisItem: (xAxisItem) =>
        set((s) => {
          const allowed = allowedChartTypes({ xAxisItem, yAxisItem: s.yAxisItem, colorItem: s.colorItem })
          return { xAxisItem, chartType: pickLegalChartType(s.chartType, allowed) }
        }),
      setYAxisItem: (yAxisItem) =>
        set((s) => {
          const yAggregation = yAxisItem ? defaultAggregationForMeasureId(yAxisItem.id) : s.yAggregation
          const allowed = allowedChartTypes({ xAxisItem: s.xAxisItem, yAxisItem, colorItem: s.colorItem })
          return {
            yAxisItem,
            yAggregation: yAxisItem ? yAggregation : 'SUM',
            chartType: pickLegalChartType(s.chartType, allowed),
          }
        }),
      setYAggregation: (yAggregation) => set({ yAggregation }),
      setColorItem: (colorItem) =>
        set((s) => {
          const allowed = allowedChartTypes({ xAxisItem: s.xAxisItem, yAxisItem: s.yAxisItem, colorItem })
          return { colorItem, chartType: pickLegalChartType(s.chartType, allowed) }
        }),
      setChartType: (chartType) => set({ chartType }),
      clearX: () => set({ xAxisItem: null }),
      clearY: () => set({ yAxisItem: null, yAggregation: 'SUM' }),
      clearColor: () =>
        set((s) => {
          const allowed = allowedChartTypes({ xAxisItem: s.xAxisItem, yAxisItem: s.yAxisItem, colorItem: null })
          return { colorItem: null, chartType: pickLegalChartType(s.chartType, allowed) }
        }),
      addFilterVariable: (v) =>
        set((s) => {
          if (s.filterItems.some((p) => p.id === v.id)) return s
          return {
            filterItems: [...s.filterItems, v],
            draftFilters: [...s.draftFilters, defaultDraftFilterForVariable(v)],
          }
        }),
      removeFilterVariable: (id) =>
        set((s) => ({
          filterItems: s.filterItems.filter((p) => p.id !== id),
          draftFilters: s.draftFilters.filter((f) => f.fieldId !== id),
        })),
      updateDraftFilter: (fieldId, patch) =>
        set((s) => ({
          draftFilters: s.draftFilters.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f)),
        })),
      addDimension: (name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => ({
          dimensions: [...s.dimensions, { id: `dim-${crypto.randomUUID()}`, name: trimmed, type: 'dimension' }],
        }))
      },
      addMeasure: (name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => ({
          measures: [...s.measures, { id: `meas-${crypto.randomUUID()}`, name: trimmed, type: 'measure' }],
        }))
      },
      resetDraft: () =>
        set({
          dimensions: defaultDimensions(),
          measures: defaultMeasures(),
          searchTerm: '',
          xAxisItem: null,
          yAxisItem: null,
          yAggregation: 'SUM',
          colorItem: null,
          filterItems: [],
          draftFilters: [],
          chartType: 'bar',
        }),
      importStateSlice: (partial) => set(partial),
    }),
    {
      name: PERSIST_NAME,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        draftVersion: s.draftVersion,
        dimensions: s.dimensions,
        measures: s.measures,
        searchTerm: s.searchTerm,
        xAxisItem: s.xAxisItem,
        yAxisItem: s.yAxisItem,
        yAggregation: s.yAggregation,
        colorItem: s.colorItem,
        filterItems: s.filterItems,
        draftFilters: s.draftFilters,
        chartType: s.chartType,
      }),
    },
  ),
)

export function clearAnalyticsDraftStorage() {
  try {
    sessionStorage.removeItem(PERSIST_NAME)
    sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * One-time migration from legacy session blob (must run after store module load).
 * @param {string} uid
 */
export function migrateLegacyAnalyticsSnapshot(uid) {
  try {
    const raw = sessionStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return
    const o = JSON.parse(raw)
    if (o?.uid !== uid || o?.v !== 1) return
    const dims =
      Array.isArray(o.dimensions) && o.dimensions.length && o.dimensions.every(isVariableShape)
        ? o.dimensions
        : defaultDimensions()
    const meas =
      Array.isArray(o.measures) && o.measures.length && o.measures.every(isVariableShape)
        ? o.measures
        : defaultMeasures()
    const xi = o.xAxisItem?.type === 'dimension' ? variableInPool(o.xAxisItem, dims, meas) : null
    const yi = o.yAxisItem?.type === 'measure' ? variableInPool(o.yAxisItem, dims, meas) : null
    const yAgg = yi ? defaultAggregationForMeasureId(yi.id) : 'SUM'
    useAnalyticsDraftStore.setState({
      dimensions: dims,
      measures: meas,
      searchTerm: typeof o.searchTerm === 'string' ? o.searchTerm : '',
      xAxisItem: xi,
      yAxisItem: yi,
      yAggregation: yAgg,
      colorItem: o.colorItem?.type === 'dimension' ? variableInPool(o.colorItem, dims, meas) : null,
      filterItems: Array.isArray(o.filterItems)
        ? o.filterItems.filter(isVariableShape).map((v) => variableInPool(v, dims, meas)).filter(Boolean)
        : [],
      draftFilters: [],
      chartType: o.chartType === 'bar' || o.chartType === 'line' || o.chartType === 'pie' || o.chartType === 'scatter' ? o.chartType : 'bar',
    })
    sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
