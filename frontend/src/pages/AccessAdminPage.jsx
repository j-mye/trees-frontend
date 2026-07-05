import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import AppNavbar from '../components/AppNavbar.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  approveAccessUser,
  fetchPendingUsers,
  fetchAllAccessUsers,
  rejectAccessUser,
  updateAccessUser,
  isAccessApiConfigured,
} from '../access/accessApi.js'

const ROLES = ['viewer', 'arborist', 'admin']
const TIERS = ['standard', 'analyst', 'supervisor', 'executive']

/** @param {Record<string, unknown>} u @param {string} query */
function userMatchesSearch(u, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    u.user_id,
    u.email,
    u.display_name,
    u.organization,
    u.access_note,
    u.approval_status,
    u.role,
    u.tier,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export default function AccessAdminPage() {
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, loading: accessLoading } = useAccess()
  const [pending, setPending] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [tab, setTab] = useState('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!user || !isAccessApiConfigured()) return
    setError('')
    try {
      const [p, a] = await Promise.all([fetchPendingUsers(user), fetchAllAccessUsers(user)])
      setPending(Array.isArray(p.users) ? p.users : [])
      setAllUsers(Array.isArray(a.users) ? a.users : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [user])

  useEffect(() => {
    if (!authLoading && !accessLoading && isAdmin && user) {
      load()
    }
  }, [authLoading, accessLoading, isAdmin, user, load])

  if (!authLoading && !accessLoading && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleApprove(u, role, tier) {
    setBusyId(u.user_id)
    try {
      await approveAccessUser(user, { user_id: u.user_id, role, tier })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(u) {
    const reason = window.prompt('Optional reason for decline:', '') ?? ''
    setBusyId(u.user_id)
    try {
      await rejectAccessUser(user, { user_id: u.user_id, rejection_reason: reason })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleUpdate(u, role, tier, active) {
    setBusyId(u.user_id)
    try {
      await updateAccessUser(user, { user_id: u.user_id, role, tier, active })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const sourceList = tab === 'pending' ? pending : allUsers
  const filteredList = useMemo(
    () => sourceList.filter((u) => userMatchesSearch(u, searchQuery)),
    [sourceList, searchQuery],
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 font-body text-slate-900">
      <AppNavbar />
      <div className="mt-16 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <main className="mx-auto max-w-5xl px-6 py-8 pb-12">
          <header>
            <h1 className="text-2xl font-bold">Admin Access</h1>
            <p className="mt-2 text-sm text-slate-600">
              Review registration requests, assign roles and tiers, and approve portal access.
            </p>
          </header>

          <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'pending' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
              onClick={() => setTab('pending')}
            >
              Pending ({pending.length})
            </button>
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
              onClick={() => setTab('all')}
            >
              All users ({allUsers.length})
            </button>
            <button
              type="button"
              className="ml-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm"
              onClick={() => load()}
            >
              Refresh
            </button>
          </div>

          <div className="relative">
            <span
              className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[1.25rem] text-slate-400"
              aria-hidden
            >
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Look up by name, email, organization, role, or user ID…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              aria-label="Search users"
            />
            {searchQuery ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                onClick={() => setSearchQuery('')}
              >
                Clear
              </button>
            ) : null}
          </div>

          <p className="text-xs text-slate-500">
            {filteredList.length === sourceList.length
              ? `${filteredList.length} user${filteredList.length === 1 ? '' : 's'}`
              : `Showing ${filteredList.length} of ${sourceList.length} users`}
          </p>

          {error && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          )}
          </div>

          <div className="mt-6 space-y-4">
            {sourceList.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No users in this list.
              </p>
            ) : filteredList.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No users match &ldquo;{searchQuery.trim()}&rdquo;.
              </p>
            ) : (
              filteredList.map((u) => (
                <AccessUserCard
                  key={u.user_id}
                  user={u}
                  busy={busyId === u.user_id}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onUpdate={handleUpdate}
                />
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function AccessUserCard({ user: u, busy, onApprove, onReject, onUpdate }) {
  const [role, setRole] = useState(u.role || 'viewer')
  const [tier, setTier] = useState(u.tier || 'standard')
  const [active, setActive] = useState(Boolean(u.active))

  useEffect(() => {
    setRole(u.role || 'viewer')
    setTier(u.tier || 'standard')
    setActive(Boolean(u.active))
  }, [u.user_id, u.role, u.tier, u.active])

  const status = String(u.approval_status || '').toLowerCase()
  const isPending = status === 'pending'
  const isApproved = status === 'approved'
  const isRejected = status === 'rejected'

  const roleChanged = role !== (u.role || 'viewer')
  const tierChanged = tier !== (u.tier || 'standard')
  const activeChanged = active !== Boolean(u.active)
  const hasChanges = roleChanged || tierChanged || activeChanged

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{u.display_name || u.email}</p>
          <p className="text-sm text-slate-500">{u.email}</p>
          {u.organization && <p className="text-sm text-slate-500">{u.organization}</p>}
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">
          {u.approval_status || 'unknown'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <label className="text-xs font-semibold text-slate-500">
          Role
          <select
            className="mt-1 block min-w-[7rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Tier
          <select
            className="mt-1 block min-w-[7rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            disabled={busy}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {isApproved && (
          <label className="flex items-center gap-2 pb-1 text-xs font-semibold text-slate-500">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={busy}
            />
            Active
          </label>
        )}

        {isPending && (
          <>
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => onApprove(u, role, tier)}
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-60"
              disabled={busy}
              onClick={() => onReject(u)}
            >
              Decline
            </button>
          </>
        )}

        {isApproved && (
          <button
            type="button"
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 disabled:opacity-60"
            disabled={busy || !hasChanges}
            onClick={() => onUpdate(u, role, tier, active)}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}

        {isRejected && (
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => onApprove(u, role, tier)}
          >
            Re-approve
          </button>
        )}
      </div>
    </article>
  )
}
