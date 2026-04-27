import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

export const DEFAULT_PROFILE_AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDC6bpBzfX4aFhJJRf3ekRKlPeB64L6f3XU_6ulEePZFQuQNuUSrU4rVvJd_Ut8isUkDhWjppbSOkxZGC0zKmzz88LsBuedYQTd7kE2Cdu7fsyzNylGqbVXSIl59AZcCORRm0lHmqUbDO2Nm85U6m037dKZj1cyoa_tdbm5_9YEq63wEjtgWJs1uqjlPnJ2EpNTSR6Rakl7N2BKZYb2glamTQKjI3WRuo1qAgCPZYOVhLLP0oXUblt_z8Fr1vwg2Mpbsz7PjKkWRg8_'

/**
 * Account menu: avatar trigger; panel is fixed to the viewport (top/right gutters) when open.
 * @param {{ className?: string, buttonClassName?: string, avatarWrapperClassName?: string, defaultAvatarUrl?: string }} props
 */
export default function ProfileDropdown({
  className = '',
  buttonClassName = '',
  avatarWrapperClassName = '',
  defaultAvatarUrl = DEFAULT_PROFILE_AVATAR_URL,
}) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(event) {
      const el = menuRef.current
      if (el && !el.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  async function handleSignOut() {
    setOpen(false)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      navigate('/login', { replace: true })
    }
  }

  const displayName = user?.displayName?.trim() || 'City Arborist'
  const userEmail = user?.email || 'arborist@municipal.gov'

  const avatarShell =
    avatarWrapperClassName ||
    'h-8 w-8 shrink-0 overflow-hidden rounded-full bg-slate-200 shadow-[0_0_0_1px_rgb(171_179_183/0.15)]'

  const menuViewportClass =
    'fixed right-3 top-3 z-[2100] w-56 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg'

  return (
    <div className={className.trim()} ref={menuRef}>
      <button
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={`${avatarShell} flex items-center justify-center`}>
          <img
            src="/data/myers-profile.jpg"
            alt="Profile Picture"
            className="h-full w-full min-h-full min-w-full object-cover object-center"
            draggable={false}
          />
        </div>
      </button>
      {open ? (
        <div className={menuViewportClass} role="menu">
          <div className="select-none px-4 py-3" role="presentation">
            <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
          </div>
          <div className="border-t border-slate-100" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => setOpen(false)}
          >
            <span className="material-symbols-outlined shrink-0 text-[1.25rem] text-slate-500" aria-hidden>
              person
            </span>
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => setOpen(false)}
          >
            <span className="material-symbols-outlined shrink-0 text-[1.25rem] text-slate-500" aria-hidden>
              notifications
            </span>
            Notifications
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => setOpen(false)}
          >
            <span className="material-symbols-outlined shrink-0 text-[1.25rem] text-slate-500" aria-hidden>
              settings
            </span>
            Settings
          </button>
          <div className="border-t border-slate-100" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600"
            onClick={handleSignOut}
          >
            <span className="material-symbols-outlined shrink-0 text-[1.25rem] text-slate-500" aria-hidden>
              door_front
            </span>
            Sign Out
          </button>
        </div>
      ) : null}
    </div>
  )
}
