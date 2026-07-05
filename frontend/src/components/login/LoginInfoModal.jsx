import { useEffect, useId } from 'react'

/**
 * Centered overlay dialog for login-page legal and help content.
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {() => void} props.onClose
 * @param {import('react').ReactNode} props.children
 */
export function LoginInfoModal({ open, title, onClose, children }) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/10 px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-on-surface">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xl leading-none text-outline hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        <div className="shrink-0 border-t border-outline-variant/10 px-5 py-3">
          <button
            type="button"
            className="w-full rounded-xl bg-surface-container-high px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
