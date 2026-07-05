import { StyledListbox } from '../components/StyledListbox.jsx'
import { MultiValueFilter } from '../components/MultiValueFilter.jsx'
import { AGGREGATIONS } from '../types.js'
import { CATALOG_DIMENSIONS, CATALOG_MEASURES } from '../fieldCatalog.js'

const scrollPane =
  'flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.surface.dim)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[10px] [&::-webkit-scrollbar-thumb]:bg-surface-dim'

const selectClass =
  'w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'

/** @param {string} fieldId */
function isNumericCatalogField(fieldId) {
  return Boolean(
    [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES].find((c) => c.id === fieldId && c.valueType === 'number'),
  )
}

const NUMERIC_FILTER_OPS = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
]
const CATEGORICAL_FILTER_OPS = [{ value: 'eq', label: '=' }]

/**
 * @param {object} props
 * @param {{ id: string, name: string, type: string }} props.variable
 * @param {import('../types.js').DraftFilter | undefined} props.filter
 * @param {string[]} props.valueOptions
 * @param {(patch: object) => void} props.onChange
 * @param {() => void} props.onRemove
 */
function FilterRow({ variable, filter, valueOptions, onChange, onRemove }) {
  const numeric = isNumericCatalogField(variable.id)
  const f = filter ?? { fieldId: variable.id, op: numeric ? 'gte' : 'eq', value: '' }
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-on-surface">{variable.name}</span>
        <button
          type="button"
          aria-label={`Remove ${variable.name} filter`}
          className="shrink-0 rounded p-0.5 text-on-surface-variant hover:text-primary"
          onClick={onRemove}
        >
          <span className="material-symbols-outlined text-sm leading-none">close</span>
        </button>
      </div>
      <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-1.5">
        <StyledListbox
          className="w-full"
          value={f.op}
          options={numeric ? NUMERIC_FILTER_OPS : CATEGORICAL_FILTER_OPS}
          onChange={(v) => onChange({ op: /** @type {import('../types.js').FilterOp} */ (v) })}
        />
        <div>
          <input
            className="w-full rounded border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-xs placeholder-on-surface-variant/50 focus:border-primary focus:outline-none"
            placeholder={numeric ? 'Enter number' : 'Enter value'}
            value={f.value}
            list={valueOptions.length ? `${variable.id}-opts` : undefined}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          {valueOptions.length ? (
            <datalist id={`${variable.id}-opts`}>
              {valueOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {{ id: string, name: string, type: 'dimension' } | null} props.xAxisItem
 * @param {{ id: string, name: string, type: 'measure' } | null} props.yAxisItem
 * @param {import('../types.js').Aggregation} props.yAggregation
 * @param {(v: { id: string, name: string, type: 'dimension' }) => void} props.onSetX
 * @param {() => void} props.onClearX
 * @param {(v: { id: string, name: string, type: 'measure' }) => void} props.onSetY
 * @param {() => void} props.onClearY
 * @param {(a: import('../types.js').Aggregation) => void} props.onYAggregation
 * @param {{ id: string, name: string, type: 'dimension' } | null} props.colorItem
 * @param {{ value: string, label: string }[]} props.colorOptions
 * @param {string} props.selectedColorId
 * @param {(id: string) => void} props.onSelectColorId
 * @param {() => void} props.onClearColor
 * @param {{ id: string, name: string }[]} props.filterItems
 * @param {import('../types.js').DraftFilter[]} props.draftFilters
 * @param {(id: string, patch: object) => void} props.onUpdateDraftFilter
 * @param {(id: string) => void} props.onRemoveFilter
 * @param {(v: { id: string, name: string, type: 'dimension' | 'measure' }) => void} props.onAddFilterVariable
 * @param {Record<string, string[]>} props.filterValueOptionsByField
 * @param {{ value: string, label: string }[]} props.quarterSectionOptions
 * @param {string[]} props.selectedQuarterSections
 * @param {(values: string[]) => void} props.onQuarterSectionsChange
 * @param {{ value: string, label: string }[]} props.districtOptions
 * @param {string[]} props.selectedDistricts
 * @param {(values: string[]) => void} props.onDistrictsChange
 * @param {{ id: string, name: string, type: 'dimension' }[]} props.dimensions
 * @param {{ id: string, name: string, type: 'measure' }[]} props.measures
 * @param {boolean} props.canRun
 * @param {boolean} props.runBusy
 * @param {() => void} props.onRunQuery
 * @param {boolean} props.dataLoading
 */
export function BuilderPane({
  xAxisItem,
  yAxisItem,
  yAggregation,
  onSetX,
  onClearX,
  onSetY,
  onClearY,
  onYAggregation,
  colorItem,
  colorOptions,
  selectedColorId,
  onSelectColorId,
  onClearColor,
  filterItems,
  draftFilters,
  onUpdateDraftFilter,
  onRemoveFilter,
  onAddFilterVariable,
  filterValueOptionsByField,
  quarterSectionOptions,
  selectedQuarterSections,
  onQuarterSectionsChange,
  districtOptions,
  selectedDistricts,
  onDistrictsChange,
  dimensions,
  measures,
  canRun,
  runBusy,
  onRunQuery,
  dataLoading,
}) {
  const yAggregationOptions = AGGREGATIONS.map((a) => ({ value: a, label: a }))

  const filterableFields = [...CATALOG_DIMENSIONS, ...CATALOG_MEASURES].filter(
    (f) => !filterItems.some((fi) => fi.id === f.id),
  )

  return (
    <section className="flex min-h-0 w-[38%] min-w-0 flex-col overflow-hidden border-r border-outline-variant/15 bg-surface">
      <div className="shrink-0 border-b border-outline-variant/15 px-5 py-4">
        <h2 className="text-sm font-bold text-on-surface">Tree Analytics</h2>
        <p className="text-[11px] text-on-surface-variant">Milwaukee Urban Forest</p>
      </div>

      <div className={`${scrollPane} space-y-6 px-5 py-5`}>

        {/* ── X-Axis ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            Group by (X-Axis)
          </label>
          <select
            value={xAxisItem?.id ?? ''}
            disabled={dataLoading}
            className={selectClass}
            onChange={(e) => {
              if (!e.target.value) { onClearX(); return }
              const dim = dimensions.find((d) => d.id === e.target.value)
              if (dim) onSetX(dim)
            }}
          >
            <option value="">Choose a category…</option>
            {dimensions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* ── Y-Axis ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            Measure (Y-Axis)
          </label>
          <select
            value={yAxisItem?.id ?? ''}
            disabled={dataLoading}
            className={selectClass}
            onChange={(e) => {
              if (!e.target.value) { onClearY(); return }
              const meas = measures.find((m) => m.id === e.target.value)
              if (meas) onSetY(meas)
            }}
          >
            <option value="">Choose what to measure…</option>
            {measures.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {yAxisItem ? (
            <div className="flex items-center gap-2 pt-0.5">
              <span className="shrink-0 text-[10px] text-on-surface-variant">Aggregation:</span>
              <StyledListbox
                className="flex-1"
                value={yAggregation}
                options={yAggregationOptions}
                onChange={(v) => onYAggregation(/** @type {import('../types.js').Aggregation} */ (v))}
              />
            </div>
          ) : null}
        </div>

        {/* ── Color / Legend ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
            Color / Split by
          </label>
          <StyledListbox
            className="w-full"
            value={selectedColorId}
            options={colorOptions}
            onChange={onSelectColorId}
          />
          {colorItem ? (
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={onClearColor}
            >
              Clear color
            </button>
          ) : null}
        </div>

        {/* ── Filters ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Filters</p>
          <MultiValueFilter
            label="Quarter section"
            searchPlaceholder="Search quarter sections…"
            options={quarterSectionOptions}
            selected={selectedQuarterSections}
            onChange={onQuarterSectionsChange}
          />
          <MultiValueFilter
            label="District"
            searchPlaceholder="Search districts…"
            options={districtOptions}
            selected={selectedDistricts}
            onChange={onDistrictsChange}
          />
          {filterItems.map((v) => (
            <FilterRow
              key={v.id}
              variable={v}
              filter={draftFilters.find((f) => f.fieldId === v.id)}
              valueOptions={filterValueOptionsByField[v.id] ?? []}
              onChange={(patch) => onUpdateDraftFilter(v.id, patch)}
              onRemove={() => onRemoveFilter(v.id)}
            />
          ))}
          {filterableFields.length > 0 ? (
            <select
              value=""
              className="w-full rounded-lg border border-dashed border-outline-variant/40 bg-transparent px-3 py-2 text-[11px] text-on-surface-variant focus:border-primary focus:outline-none"
              onChange={(e) => {
                if (!e.target.value) return
                const field = filterableFields.find((f) => f.id === e.target.value)
                if (field) onAddFilterVariable({ id: field.id, name: field.name, type: field.type })
                e.target.value = ''
              }}
            >
              <option value="">+ Add field filter…</option>
              {filterableFields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          ) : null}
        </div>

      </div>

      {/* ── Run button ── */}
      <div className="shrink-0 border-t border-outline-variant/10 p-5">
        <button
          type="button"
          disabled={!canRun || runBusy}
          title={canRun ? undefined : 'Choose a group-by and measure above'}
          onClick={onRunQuery}
          className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dim py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runBusy ? 'Generating…' : 'Generate Chart'}
        </button>
        {!xAxisItem || !yAxisItem ? (
          <p className="mt-2 text-center text-[10px] text-on-surface-variant">
            Select a category and measure above
          </p>
        ) : null}
      </div>
    </section>
  )
}
