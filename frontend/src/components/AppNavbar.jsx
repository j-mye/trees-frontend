import { Link, useLocation } from 'react-router-dom'
import ProfileDropdown from './ProfileDropdown.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'

const navInactive = 'font-medium text-slate-500 transition-colors hover:text-indigo-500'
const navActive = 'border-b-2 border-indigo-600 font-semibold text-indigo-700 transition-colors'

const FEEDBACK_FORM_URL = 'https://forms.gle/xZat2eFHrRKAAsBT7'

/**
 * Active link is derived from the current route.
 */
export default function AppNavbar() {
  const { pathname } = useLocation()
  const { isAdmin } = useAccess()
  const onMap = pathname === '/' || pathname === '/dashboard'
  const onAnalytics = pathname === '/analytics'
  const onHistoryReport = pathname === '/history-report'
  const onDataManagement = pathname === '/data-management'
  const onUserTasks = pathname === '/user-tasks'
  const onAccessAdmin = pathname === '/admin/access'

  return (
    <nav className="fixed top-0 z-[2000] flex h-16 w-full max-w-full items-center justify-between bg-slate-50/80 px-8 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-on-primary">
            <span className="material-symbols-outlined">nature</span>
          </div>
          <span className="font-inter text-xl font-bold tracking-tight text-slate-900">Pruning Planner</span>
        </div>
        <div className="hidden items-center gap-6 md:flex">
          <Link to="/dashboard" className={onMap ? navActive : navInactive}>
            Inventory
          </Link>
          <Link to="/analytics" className={onAnalytics ? navActive : navInactive}>
            Analytics
          </Link>
          <Link to="/history-report" className={onHistoryReport ? navActive : navInactive}>
            History
          </Link>
          <Link to="/data-management" className={onDataManagement ? navActive : navInactive}>
            Data Management
          </Link>
          <Link to="/user-tasks" className={onUserTasks ? navActive : navInactive}>
            User Tasks
          </Link>
          {isAdmin ? (
            <Link to="/admin/access" className={onAccessAdmin ? navActive : navInactive}>
              Admin Access
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <a
          href={FEEDBACK_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden>
            feedback
          </span>
          Give Feedback
        </a>
        <ProfileDropdown
          className="relative flex items-center"
          buttonClassName="cursor-pointer rounded-full border-0 bg-transparent p-0 leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          avatarWrapperClassName="h-8 w-8 overflow-hidden rounded-full bg-slate-200 shadow-[0_0_0_1px_rgb(171_179_183/0.15)]"
        />
      </div>
    </nav>
  )
}
