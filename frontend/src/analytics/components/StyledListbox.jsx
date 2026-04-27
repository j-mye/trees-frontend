import { useEffect, useId, useRef, useState } from 'react'

/**
 * Headless-style single-select: full Tailwind styling, no native `<select>` chrome.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {{ value: string, label: string }[]} props.options
 * @param {string} [props.className]
 * @param {string} [props.buttonClassName]
 */
export function StyledListbox({ value, onChange, options, className = '', buttonClassName = '' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const listId = useId()
  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (/** @type {MouseEvent} */ e) => {
      const el = rootRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`flex w-full min-w-0 items-center justify-between gap-1 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-2 py-1.5 text-left text-[10px] font-medium text-on-surface shadow-sm transition-colors hover:border-primary/50 hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-primary/35 ${buttonClassName}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <span
          className={`material-symbols-outlined shrink-0 text-sm text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        >
          expand_more
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 right-0 top-full z-[80] mt-0.5 max-h-48 overflow-y-auto rounded-md border border-outline-variant/35 bg-surface-container-lowest py-0.5 shadow-lg"
        >
          {options.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`cursor-pointer px-2 py-1.5 text-[10px] ${
                opt.value === value ? 'bg-primary/12 font-semibold text-primary' : 'text-on-surface hover:bg-surface-container-high'
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
