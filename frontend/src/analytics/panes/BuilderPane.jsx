import { useDroppable } from '@dnd-kit/core'
import { useState } from 'react'
import { StyledListbox } from '../components/StyledListbox.jsx'
import { AGGREGATIONS } from '../types.js'
import { CATALOG_DIMENSIONS, CATALOG_MEASURES } from '../fieldCatalog.js'

const NUMERIC_FILTER_OPTIONS = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
]

const CATEGORICAL_FILTER_OPTIONS = [{ value: 'eq', label: 'equals' }]

const scrollPane =
  'flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.surface.dim)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[10px] [&::-webkit-scrollbar-thumb]:bg-surface-dim'

/**
 * @param {object} props
 * @param {string} props.zoneId
 * @param {string} props.minHeightClass
 * @param {boolean} props.isActiveDrag
 * @param {boolean} props.isEmpty
 * @param {import('react').ReactNode} props.placeholder
 * @param {import('react').ReactNode} props.filled
 */
function DroppableZone({ zoneId, minHeightClass, isActiveDrag, isEmpty, placeholder, filled }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${zoneId}`,
    data: { zone: zoneId },
  })
  return (
    <div
      ref={setNodeRef}
      className={`${minHeightClass} flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-outline-variant/30 bg-surface-container-low transition-all hover:border-primary/50 hover:bg-indigo-50 ${
        isActiveDrag || isOver ? 'border-primary/60 bg-indigo-50/80 ring-2 ring-primary/30' : ''
      } ${!isEmpty ? 'border-solid border-outline-variant/25' : ''}`}
    >
      {isEmpty ? placeholder : filled}
    </div>
  )
}

/**
 * @param {string} fieldId
 */
function isNumericCatalogField(fieldId) {
  return Boolean(
    [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES].find((c) => c.id === fieldId && c.valueType === 'number'),
  )
}

/**
 * @param {object} props
 * @param {{ id: string, name: string, type: string }} props.variable
 * @param {import('../types.js').DraftFilter | undefined} props.filter
 * @param {(patch: object) => void} props.onChange
 * @param {() => void} props.onRemove
 */
function FilterRow({ variable, filter, onChange, onRemove }) {
  const [open, setOpen] = useState(false)
  const numeric = isNumericCatalogField(variable.id)
  const f = filter ?? { fieldId: variable.id, op: numeric ? 'gte' : 'eq', value: '' }
  return (
    <div className="relative flex w-full flex-col gap-1 rounded-lg bg-surface-container-high px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-xs font-medium text-on-surface" onClick={() => setOpen((o) => !o)}>
          {variable.name}
        </button>
        <button
          type="button"
          aria-label={`Remove ${variable.name}`}
          className="shrink-0 rounded p-0.5 text-on-surface-variant hover:text-primary"
          onClick={onRemove}
        >
          <span className="material-symbols-outlined text-sm leading-none">close</span>
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-outline-variant/20 pt-1">
          {numeric ? (
            <StyledListbox
              className="w-full"
              value={f.op}
              options={NUMERIC_FILTER_OPTIONS}
              onChange={(v) => onChange({ op: /** @type {import('../types.js').FilterOp} */ (v) })}
            />
          ) : (
            <StyledListbox
              className="w-full"
              value={f.op}
              options={CATEGORICAL_FILTER_OPTIONS}
              onChange={(v) => onChange({ op: /** @type {import('../types.js').FilterOp} */ (v) })}
            />
          )}
          <input
            className="rounded border border-outline-variant/30 bg-surface-container-lowest px-1 py-0.5 text-[10px]"
            placeholder={numeric ? 'Number' : 'Text'}
            value={f.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * @param {object} props
 * @param {boolean} props.dragActive
 * @param {{ id: string, name: string, type: 'dimension' } | null} props.xAxisItem
 * @param {{ id: string, name: string, type: 'measure' } | null} props.yAxisItem
 * @param {import('../types.js').Aggregation} props.yAggregation
 * @param {(a: import('../types.js').Aggregation) => void} props.onYAggregation
 * @param {{ id: string, name: string, type: 'dimension' } | null} props.colorItem
 * @param {{ id: string, name: string }[]} props.filterItems
 * @param {import('../types.js').DraftFilter[]} props.draftFilters
 * @param {(id: string, patch: object) => void} props.onUpdateDraftFilter
 * @param {() => void} props.onClearX
 * @param {() => void} props.onClearY
 * @param {() => void} props.onClearColor
 * @param {(id: string) => void} props.onRemoveFilter
 * @param {boolean} props.canRun
 * @param {boolean} props.runBusy
 * @param {() => void} props.onRunQuery
 */
export function BuilderPane({
  dragActive,
  xAxisItem,
  yAxisItem,
  yAggregation,
  onYAggregation,
  colorItem,
  filterItems,
  draftFilters,
  onUpdateDraftFilter,
  onClearX,
  onClearY,
  onClearColor,
  onRemoveFilter,
  canRun,
  runBusy,
  onRunQuery,
}) {
  const dropPlaceholder = (icon, text) => (
    <>
      <span className="material-symbols-outlined text-2xl text-outline">{icon}</span>
      <span className="text-[10px] font-medium text-outline">{text}</span>
    </>
  )

  const filledChip = (variable, onClear) => (
    <div className="flex w-full flex-col gap-1 px-3 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <span
          className={`truncate text-xs font-semibold ${variable.type === 'dimension' ? 'text-on-primary-container' : 'text-emerald-800'}`}
        >
          {variable.name}
        </span>
        <button
          type="button"
          aria-label="Remove"
          className="shrink-0 rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
          onClick={onClear}
        >
          <span className="material-symbols-outlined text-base leading-none">close</span>
        </button>
      </div>
      {variable.type === 'measure' ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-on-surface-variant">
          <span className="shrink-0 font-bold uppercase">Agg</span>
          <StyledListbox
            className="min-w-0 flex-1"
            value={yAggregation}
            options={AGGREGATIONS.map((a) => ({ value: a, label: a }))}
            onChange={(v) => onYAggregation(/** @type {import('../types.js').Aggregation} */ (v))}
          />
        </div>
      ) : null}
    </div>
  )

  return (
    <section className="flex min-h-0 w-[25%] min-w-0 flex-col overflow-hidden border-r border-outline-variant/15 bg-surface">
      <div className="border-b border-outline-variant/15 p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Builder</h3>
      </div>
      <div className={`${scrollPane} space-y-6 p-6`}>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">X-Axis / Group by</label>
          <DroppableZone
            zoneId="x"
            minHeightClass="h-24"
            isActiveDrag={dragActive}
            isEmpty={!xAxisItem}
            placeholder={dropPlaceholder('add_circle', 'Drop a Dimension')}
            filled={xAxisItem ? filledChip(xAxisItem, onClearX) : null}
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Y-Axis / Measure</label>
          <DroppableZone
            zoneId="y"
            minHeightClass="h-24"
            isActiveDrag={dragActive}
            isEmpty={!yAxisItem}
            placeholder={dropPlaceholder('add_circle', 'Drop a Measure')}
            filled={yAxisItem ? filledChip(yAxisItem, onClearY) : null}
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Color / Legend</label>
          <DroppableZone
            zoneId="color"
            minHeightClass="h-24"
            isActiveDrag={dragActive}
            isEmpty={!colorItem}
            placeholder={dropPlaceholder('palette', 'Drop a Dimension')}
            filled={colorItem ? filledChip(colorItem, onClearColor) : null}
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Filters</label>
          <DroppableZone
            zoneId="filters"
            minHeightClass="h-32"
            isActiveDrag={dragActive}
            isEmpty={filterItems.length === 0}
            placeholder={dropPlaceholder('filter_alt', 'Drop fields to filter')}
            filled={
              <div className="flex max-h-40 w-full flex-col gap-1 overflow-y-auto px-2 py-1">
                {filterItems.map((v) => (
                  <FilterRow
                    key={v.id}
                    variable={v}
                    filter={draftFilters.find((f) => f.fieldId === v.id)}
                    onChange={(patch) => onUpdateDraftFilter(v.id, patch)}
                    onRemove={() => onRemoveFilter(v.id)}
                  />
                ))}
              </div>
            }
          />
        </div>
      </div>
      <div className="mt-auto p-6">
        <button
          type="button"
          disabled={!canRun || runBusy}
          title={canRun ? undefined : 'Choose X (dimension) and Y (measure), then run'}
          onClick={onRunQuery}
          className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dim py-3 font-bold text-on-primary shadow-lg shadow-primary/20 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runBusy ? 'Running…' : 'Run Query'}
        </button>
      </div>
    </section>
  )
}
