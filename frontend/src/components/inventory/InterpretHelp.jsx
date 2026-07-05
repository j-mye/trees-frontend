import { useId, useState } from 'react'

/**
 * @param {object} props
 * @param {string} props.title Accessible label for the help control
 * @param {import('react').ReactNode} props.children
 */
export function InterpretHelp({ title, children }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={title}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 shadow-sm hover:border-indigo-200 hover:text-indigo-700"
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          className="absolute right-0 top-6 z-[1100] w-64 rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-700 shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-semibold text-slate-900">{title}</p>
            <button
              type="button"
              className="shrink-0 text-slate-400 hover:text-slate-700"
              aria-label="Close help"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  )
}
