import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function RegisterAccessPage() {
  const { user, loading: authLoading } = useAuth()
  const { submitRegistration, isApproved, approvalRequired, accessApiConfigured, loading } =
    useAccess()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [organization, setOrganization] = useState('')
  const [accessNote, setAccessNote] = useState('')
  const [err, setErr] = useState(null)
  const [pending, setPending] = useState(false)

  if (!authLoading && !user) {
    return <Navigate to="/login" replace />
  }

  if (!accessApiConfigured || !approvalRequired) {
    return <Navigate to="/dashboard" replace />
  }

  if (isApproved) {
    return <Navigate to="/dashboard" replace />
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null)
    setPending(true)
    try {
      await submitRegistration({
        display_name: displayName.trim(),
        organization: organization.trim(),
        access_note: accessNote.trim(),
      })
      navigate('/pending-approval', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center bg-surface p-6 font-body text-on-surface">
      <form className="glass-panel w-full max-w-lg rounded-2xl p-8 shadow-2xl" onSubmit={onSubmit}>
        <h1 className="text-2xl font-bold text-gray-800">Complete access request</h1>
        <p className="mt-3 text-sm text-on-surface-variant">
          Tell us who you are and why you need access. An administrator will review your request and
          email you when approved.
        </p>
        <div className="mt-6 space-y-4">
          <label className="block text-xs font-semibold text-on-surface-variant">
            Full name
            <input
              className="mt-1 block w-full rounded-xl border-none bg-surface-container-high px-4 py-3"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={pending || loading}
            />
          </label>
          <label className="block text-xs font-semibold text-on-surface-variant">
            Organization / department
            <input
              className="mt-1 block w-full rounded-xl border-none bg-surface-container-high px-4 py-3"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              required
              disabled={pending || loading}
            />
          </label>
          <label className="block text-xs font-semibold text-on-surface-variant">
            Reason for access
            <textarea
              className="mt-1 block min-h-[96px] w-full rounded-xl border-none bg-surface-container-high px-4 py-3"
              value={accessNote}
              onChange={(e) => setAccessNote(e.target.value)}
              required
              disabled={pending || loading}
            />
          </label>
        </div>
        {err && (
          <p className="mt-4 text-center text-sm font-medium text-error" role="alert">
            {err}
          </p>
        )}
        <button
          type="submit"
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-primary to-primary-dim py-3.5 font-bold text-on-primary disabled:opacity-60"
          disabled={pending || loading}
        >
          {pending ? 'Submitting…' : 'Submit for approval'}
        </button>
      </form>
    </div>
  )
}
