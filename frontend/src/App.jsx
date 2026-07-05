import { useLayoutEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import RequireApprovedAuth from './components/RequireApprovedAuth.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import MapDashboardPage from './pages/MapDashboardPage.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'
import TreeRecordManagementPage from './pages/TreeRecordManagementPage.jsx'
import UserTasksPage from './pages/UserTasksPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import PendingApprovalPage from './pages/PendingApprovalPage.jsx'
import AccessDeniedPage from './pages/AccessDeniedPage.jsx'
import RegisterAccessPage from './pages/RegisterAccessPage.jsx'
import AccessAdminPage from './pages/AccessAdminPage.jsx'
import HistoryReportPage from './pages/HistoryReportPage.jsx'

const FULL_BLEED_PATHS = [
  '/',
  '/dashboard',
  '/map',
  '/priority-map',
  '/risk-heatmap',
  '/analytics',
  '/history-report',
  '/data-management',
  '/user-tasks',
  '/admin/access',
  '/login',
  '/register-access',
  '/pending-approval',
  '/access-denied',
]

function ProtectedPage({ children }) {
  return (
    <RequireApprovedAuth>
      <ErrorBoundary>{children}</ErrorBoundary>
    </RequireApprovedAuth>
  )
}

function RootLayoutClass() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    const root = document.getElementById('root')
    const fullBleed = FULL_BLEED_PATHS.includes(pathname)
    root?.classList.toggle('app-full-bleed', fullBleed)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <RootLayoutClass />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register-access" element={<RegisterAccessPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />
        <Route
          path="/"
          element={
            <ProtectedPage>
              <MapDashboardPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedPage>
              <MapDashboardPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedPage>
              <AnalyticsPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/history-report"
          element={
            <ProtectedPage>
              <HistoryReportPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/data-management"
          element={
            <ProtectedPage>
              <TreeRecordManagementPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/user-tasks"
          element={
            <ProtectedPage>
              <UserTasksPage />
            </ProtectedPage>
          }
        />
        <Route
          path="/admin/access"
          element={
            <ProtectedPage>
              <AccessAdminPage />
            </ProtectedPage>
          }
        />
        <Route path="/dashboard.html" element={<Navigate to="/dashboard" replace />} />
        <Route path="/map" element={<Navigate to="/dashboard" replace />} />
        <Route path="/priority-map" element={<Navigate to="/dashboard" replace />} />
        <Route path="/risk-heatmap" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
