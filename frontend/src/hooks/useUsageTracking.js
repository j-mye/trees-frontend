import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'
import { isAccessApiConfigured, logUsageEvents } from '../access/accessApi.js'
import { toolFromPathname } from '../utils/usageTools.js'

const FLUSH_MS = 15_000
const SKIP_PATH_PREFIXES = ['/login', '/register-access', '/pending-approval', '/access-denied']

/**
 * Fire-and-forget page-view tracking for approved portal users.
 * Batches events and POSTs to accessApi action=log_usage.
 */
export function UsageTracker() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { isApproved, loading } = useAccess()
  const queueRef = useRef(/** @type {object[]} */ ([]))
  const lastPathRef = useRef('')
  const timerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))

  useEffect(() => {
    if (loading || !user || !isApproved || !isAccessApiConfigured()) return undefined
    if (SKIP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return undefined

    const tool = toolFromPathname(pathname)
    if (!tool) return undefined
    if (lastPathRef.current === pathname) return undefined
    lastPathRef.current = pathname

    queueRef.current.push({
      event_id: crypto.randomUUID(),
      tool,
      event_type: 'page_view',
      path: pathname,
      occurred_at: new Date().toISOString(),
    })

    const flush = () => {
      if (!queueRef.current.length) return
      const batch = queueRef.current.splice(0, queueRef.current.length)
      logUsageEvents(user, batch).catch(() => {
        /* non-blocking */
      })
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, FLUSH_MS)

    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [pathname, user, isApproved, loading])

  return null
}

/** @param {import('firebase/auth').User} user @param {object} event */
export function trackUsageAction(user, event) {
  if (!user || !isAccessApiConfigured()) return
  logUsageEvents(user, [
    {
      event_id: crypto.randomUUID(),
      event_type: 'action',
      occurred_at: new Date().toISOString(),
      ...event,
    },
  ]).catch(() => {})
}
