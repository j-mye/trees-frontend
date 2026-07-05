import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { registerAccessRequest, isAccessApiConfigured } from '../access/accessApi.js'

export default function PendingApprovalPage() {
  const { profile, refresh, loading, isApproved, error } = useAccess()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && isApproved) {
      navigate('/dashboard', { replace: true })
    }
  }, [loading, isApproved, navigate])

  async function handleCheckStatus() {
    await refresh()
    if (user && isAccessApiConfigured()) {
      try {
        await registerAccessRequest(user, {
          display_name: profile?.display_name || '',
          organization: profile?.organization || '',
          access_note: profile?.access_note || '',
        })
        await refresh()
      } catch {
        /* refresh still runs; register may no-op for non-bootstrap */
      }
    }
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center bg-surface p-6 font-body text-on-surface">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-gray-800">Access pending approval</h1>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
          Your account was created successfully. A municipal administrator must approve your access
          before you can use the Pruning Planner portal.
        </p>
        {profile?.email && (
          <p className="mt-4 text-sm text-slate-600">
            Signed in as <span className="font-semibold">{profile.email}</span>
            {profile.organization ? ` · ${profile.organization}` : ''}
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm font-medium text-error" role="alert">
            {error}
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary disabled:opacity-60"
            disabled={loading}
            onClick={handleCheckStatus}
          >
            {loading ? 'Checking…' : 'Check status'}
          </button>
          <button
            type="button"
            className="rounded-xl bg-secondary-container px-5 py-2.5 text-sm font-semibold text-on-secondary-container"
            onClick={() => logout()}
          >
            Sign out
          </button>
        </div>
        <p className="mt-6 text-xs text-outline">
          Questions? Contact your forestry IT administrator.
        </p>
        <Link className="mt-4 inline-block text-sm font-semibold text-primary" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
