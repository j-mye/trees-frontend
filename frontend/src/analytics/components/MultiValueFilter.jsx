import { useMemo, useState } from 'react'

/**
 * @param {object} props
 * @param {string} props.label
 * @param {{ value: string, label: string }[]} props.options
 * @param {string[]} props.selected
 * @param {(values: string[]) => void} props.onChange
 * @param {string} [props.searchPlaceholder]
 */
export function MultiValueFilter({
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = 'Search…',
}) {
  const [query, setQuery] = useState('')
  const selectedSet = new Set(selected)
  const q = query.trim().toLowerCase()

  const visibleOptions = useMemo(() => {
    if (!q) return options
    return options.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q),
    )
  }, [options, q])

  const selectedVisible = useMemo(
    () => options.filter((opt) => selectedSet.has(opt.value)),
    [options, selected],
  )

  const unselectedVisible = useMemo(
    () => visibleOptions.filter((opt) => !selectedSet.has(opt.value)),
    [visibleOptions, selected],
  )

  function toggle(value) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
          {label}
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            className="text-[10px] font-semibold text-primary hover:underline"
            onClick={() => onChange([])}
          >
            Clear ({selected.length})
          </button>
        ) : (
          <span className="text-[10px] text-outline">All</span>
        )}
      </div>
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label={`Search ${label}`}
        />
        <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-base text-on-surface-variant">
          search
        </span>
      </div>
      <div className="max-h-36 overflow-y-auto rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-2 [scrollbar-width:thin]">
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10px] text-outline">No values loaded</p>
        ) : visibleOptions.length === 0 && selectedVisible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10px] text-outline">No matches</p>
        ) : (
          <ul className="space-y-0.5">
            {selectedVisible.map((opt) => (
              <li key={`sel-${opt.value}`}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary/5 px-2 py-1.5 text-xs hover:bg-surface-container-high">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-outline-variant text-primary"
                    checked
                    onChange={() => toggle(opt.value)}
                  />
                  <span className="truncate font-medium text-on-surface">{opt.label}</span>
                </label>
              </li>
            ))}
            {unselectedVisible.map((opt) => (
              <li key={opt.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-container-high">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-outline-variant text-primary"
                    checked={false}
                    onChange={() => toggle(opt.value)}
                  />
                  <span className="truncate text-on-surface">{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {q ? (
        <p className="text-[10px] text-outline">
          {visibleOptions.length} of {options.length} shown
        </p>
      ) : null}
    </div>
  )
}
