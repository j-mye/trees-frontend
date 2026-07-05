import { useDraggable } from '@dnd-kit/core'
import { dimensionPillClass, measurePillClass } from '../pantryChipStyles.js'

const scrollPane =
  'flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.surface.dim)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[10px] [&::-webkit-scrollbar-thumb]:bg-surface-dim'

/**
 * @param {object} props
 * @param {{ id: string, name: string, type: 'dimension' | 'measure' }} props.variable
 * @param {string} props.className
 */
function PantryChip({ variable, className }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pantry:${variable.type}:${variable.id}`,
    data: { variable },
  })
  /** No transform on source: DragOverlay follows pointer; opacity 0 preserves layout slot. */
  const style = { opacity: isDragging ? 0 : undefined, touchAction: 'none' }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="listitem"
      className={className}
    >
      <span
        className={`material-symbols-outlined text-sm ${variable.type === 'dimension' ? 'text-on-primary-container' : ''}`}
      >
        drag_indicator
      </span>
      {variable.type === 'dimension' ? (
        <span className="text-on-primary-container">{variable.name}</span>
      ) : (
        variable.name
      )}
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.searchTerm
 * @param {(v: string) => void} props.onSearchTerm
 * @param {{ id: string, name: string, type: 'dimension' }[]} props.filteredDimensions
 * @param {{ id: string, name: string, type: 'measure' }[]} props.filteredMeasures
 * @param {string} [props.statusError]
 */
export function DataDictionaryPane({
  searchTerm,
  onSearchTerm,
  filteredDimensions,
  filteredMeasures,
  statusError = '',
}) {
  return (
    <section className="flex min-h-0 w-[20%] min-w-0 flex-col overflow-hidden border-r border-outline-variant/15 bg-surface-container-low">
      <div className="border-b border-outline-variant/15 p-4">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Data Dictionary</h3>
        {statusError ? (
          <p className="mb-2 text-[10px] font-medium text-red-700">{statusError}</p>
        ) : null}
        <div className="relative">
          <input
            className="w-full rounded-full border border-outline-variant/30 bg-surface-container-lowest py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search fields..."
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
          />
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-lg text-on-surface-variant">search</span>
        </div>
      </div>
      <div className={`${scrollPane} space-y-4 p-2`}>
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl p-2 transition-colors hover:bg-surface-container-high">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-on-surface">
              <span className="material-symbols-outlined shrink-0 text-lg text-primary">category</span>
              <span className="truncate">Dimensions</span>
            </span>
            <span className="material-symbols-outlined shrink-0 text-on-surface-variant transition-transform group-open:rotate-180">
              expand_more
            </span>
          </summary>
          <div className="mt-2 space-y-2 px-2">
            {filteredDimensions.map((d) => (
              <PantryChip key={d.id} variable={d} className={dimensionPillClass} />
            ))}
          </div>
        </details>
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl p-2 transition-colors hover:bg-surface-container-high">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-on-surface">
              <span className="material-symbols-outlined shrink-0 text-lg text-emerald-600">calculate</span>
              <span className="truncate">Measures</span>
            </span>
            <span className="material-symbols-outlined shrink-0 text-on-surface-variant transition-transform group-open:rotate-180">
              expand_more
            </span>
          </summary>
          <div className="mt-2 space-y-2 px-2">
            {filteredMeasures.map((m) => (
              <PantryChip key={m.id} variable={m} className={measurePillClass} />
            ))}
          </div>
        </details>
      </div>
    </section>
  )
}
