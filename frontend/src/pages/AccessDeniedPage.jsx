import { useAuth } from '../contexts/AuthContext.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'

export default function AccessDeniedPage() {
  const { logout } = useAuth()
  const { profile } = useAccess()

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center bg-surface p-6 font-body text-on-surface">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-gray-800">Access not granted</h1>
        <p className="mt-3 text-sm text-on-surface-variant leading-relaxed">
          Your request to use the Pruning Planner portal was declined. If you believe this is an
          error, contact your municipal forestry administrator.
        </p>
        {profile?.rejection_reason && (
          <p className="mt-4 rounded-lg bg-surface-container-low px-4 py-3 text-sm text-slate-700">
            {profile.rejection_reason}
          </p>
        )}
        <button
          type="button"
          className="mt-8 rounded-xl bg-secondary-container px-5 py-2.5 text-sm font-semibold text-on-secondary-container"
          onClick={() => logout()}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
