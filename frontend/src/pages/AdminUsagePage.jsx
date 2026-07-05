import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import AppNavbar from '../components/AppNavbar.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { fetchUsageStats, isAccessApiConfigured } from '../access/accessApi.js'
import { labelForUsageTool } from '../utils/usageTools.js'

const WINDOW_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export default function AdminUsagePage() {
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, loading: accessLoading } = useAccess()
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user || !isAccessApiConfigured()) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchUsageStats(user, days)
      setStats(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [user, days])

  useEffect(() => {
    if (!authLoading && !accessLoading && isAdmin && user) {
      load()
    }
  }, [authLoading, accessLoading, isAdmin, user, load])

  const maxToolEvents = useMemo(() => {
    const rows = stats?.by_tool ?? []
    return rows.reduce((m, r) => Math.max(m, r.event_count || 0), 0) || 1
  }, [stats])

  if (!authLoading && !accessLoading && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 font-body text-slate-900">
      <AppNavbar />
      <div className="mt-16 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <main className="mx-auto max-w-5xl px-6 py-8 pb-12">
          <header>
            <h1 className="text-2xl font-bold">Usage Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Tool popularity and power users from page visits across the portal. Data collection starts
              after this feature is deployed — there is no historical usage before that.
            </p>
          </header>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  days === opt.days ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'
                }`}
                onClick={() => setDays(opt.days)}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm"
              onClick={() => load()}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {stats ? (
            <div className="mt-6 space-y-8">
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total events</p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{stats.total_events}</p>
                  <p className="mt-1 text-xs text-slate-500">Last {stats.days} days</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Active users</p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{stats.active_users}</p>
                  <p className="mt-1 text-xs text-slate-500">Distinct users with at least one event</p>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800">Tools used most</h2>
                  <p className="text-xs text-slate-500">Page views by main nav area</p>
                </div>
                <div className="divide-y divide-slate-100 px-5 py-2">
                  {(stats.by_tool ?? []).length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No usage recorded yet.</p>
                  ) : (
                    stats.by_tool.map((row) => (
                      <div key={row.tool} className="flex items-center gap-4 py-3">
                        <div className="min-w-[140px] text-sm font-semibold text-slate-800">
                          {labelForUsageTool(row.tool)}
                        </div>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${Math.round((row.event_count / maxToolEvents) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-24 text-right text-sm tabular-nums text-slate-600">
                          {row.event_count}{' '}
                          <span className="text-xs text-slate-400">({row.unique_users} users)</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800">Power users</h2>
                  <p className="text-xs text-slate-500">Most active accounts by total events</p>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3 text-right">Events</th>
                        <th className="px-4 py-3 text-right">Tools</th>
                        <th className="px-4 py-3">Top tool</th>
                        <th className="px-4 py-3">Last active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(stats.power_users ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            No usage recorded yet.
                          </td>
                        </tr>
                      ) : (
                        stats.power_users.map((row, i) => (
                          <tr key={row.user_id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-900">{row.email}</div>
                              <div className="text-[10px] text-slate-400">{row.user_id}</div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">{row.event_count}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{row.tools_used}</td>
                            <td className="px-4 py-2.5 text-slate-700">
                              {labelForUsageTool(row.top_tool)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                              {formatWhen(row.last_active)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
