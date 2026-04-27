import { useLayoutEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import RequireAuth from './components/RequireAuth.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import MapDashboardPage from './pages/MapDashboardPage.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'
import TreeRecordManagementPage from './pages/TreeRecordManagementPage.jsx'
import LoginPage from './pages/LoginPage.jsx'

const FULL_BLEED_PATHS = [
  '/',
  '/dashboard',
  '/map',
  '/priority-map',
  '/risk-heatmap',
  '/analytics',
  '/data-management',
  '/login',
]

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
        <Route
          path="/"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <MapDashboardPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <MapDashboardPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/analytics"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <AnalyticsPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/data-management"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <TreeRecordManagementPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route path="/map" element={<Navigate to="/dashboard" replace />} />
        <Route path="/priority-map" element={<Navigate to="/dashboard" replace />} />
        <Route path="/risk-heatmap" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
