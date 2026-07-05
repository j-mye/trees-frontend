import { Navigate, useLocation } from 'react-router-dom'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import RequireAuth from './RequireAuth.jsx'

/**
 * Requires Firebase sign-in and (when access API is configured) approved BigQuery user row.
 */
export default function RequireApprovedAuth({ children }) {
  const { user, loading: authLoading } = useAuth()
  const { profile, isApproved, approvalRequired, loading: accessLoading, accessApiConfigured } =
    useAccess()
  const location = useLocation()

  if (authLoading || accessLoading) {
    return (
      <div className="auth-gate">
        <p>Verifying access…</p>
      </div>
    )
  }

  if (!user) {
    return <RequireAuth>{children}</RequireAuth>
  }

  if (!accessApiConfigured || !approvalRequired) {
    return <RequireAuth>{children}</RequireAuth>
  }

  if (!profile) {
    return <Navigate to="/register-access" replace state={{ from: location.pathname }} />
  }

  const status = profile.approval_status || 'pending'
  if (!isApproved) {
    if (status === 'rejected') {
      return <Navigate to="/access-denied" replace />
    }
    return <Navigate to="/pending-approval" replace />
  }

  return <RequireAuth>{children}</RequireAuth>
}
