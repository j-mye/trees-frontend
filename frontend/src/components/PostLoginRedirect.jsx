import { Navigate } from 'react-router-dom'
import { useAccess } from '../contexts/AccessContext.jsx'

/**
 * After Firebase sign-in, route based on BigQuery approval profile.
 */
export default function PostLoginRedirect({ from = '/dashboard' }) {
  const { profile, isApproved, approvalRequired, loading, accessApiConfigured } = useAccess()

  if (loading) {
    return (
      <div className="auth-bg flex h-[100vh] items-center justify-center bg-surface p-6 font-body text-on-surface">
        <p className="text-on-surface-variant">Checking access…</p>
      </div>
    )
  }

  if (!accessApiConfigured || !approvalRequired) {
    return <Navigate to={from} replace />
  }

  if (!profile) {
    return <Navigate to="/register-access" replace state={{ from }} />
  }

  if (!isApproved) {
    if (profile.approval_status === 'rejected') {
      return <Navigate to="/access-denied" replace />
    }
    return <Navigate to="/pending-approval" replace />
  }

  return <Navigate to={from} replace />
}
