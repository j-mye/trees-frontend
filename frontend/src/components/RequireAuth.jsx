import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function RequireAuth({ children }) {
  const { user, loading, firebaseConfigured } = useAuth()
  const location = useLocation()

  if (!firebaseConfigured) {
    return (
      <div className="auth-gate">
        <p>Firebase is not configured. Add <code>VITE_FIREBASE_*</code> to <code>.env</code> (see <code>.env.example</code>), then open <a href="/dashboard">/dashboard</a>.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="auth-gate">
        <p>Checking session…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
