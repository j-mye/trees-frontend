import { useEffect, useMemo, useState } from 'react'
import AppNavbar from '../components/AppNavbar.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { mapApiEnv } from '../config/mapApiEnv.js'

function InlineSpinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary ${className}`}
      aria-hidden
    />
  )
}

async function tasksApiRequest({ user, method = 'GET', mode = '', body = null }) {
  const token = await user.getIdToken()
  const baseUrl = mapApiEnv.userTasksUrl
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : ''
  const res = await fetch(`${baseUrl}${qs}`, {
    method,
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Expected JSON response (${res.status})`)
  }
  if (!res.ok) {
    const detail = json?.detail ? String(json.detail) : ''
    const hint = detail ? ` — ${detail}` : ''
    throw new Error(
      (json?.message || json?.error || `Request failed (${res.status})`) + hint
    )
  }
  return json
}

export default function UserTasksPage() {
  const { user, loading: authLoading } = useAuth()
  const [users, setUsers] = useState([])
  const [tasks, setTasks] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [partialWarning, setPartialWarning] = useState('')
  const [createUserPending, setCreateUserPending] = useState(false)
  const [createTaskPending, setCreateTaskPending] = useState(false)
  const [taskFlash, setTaskFlash] = useState('')
  const [savingAssignId, setSavingAssignId] = useState('')
  const [completingId, setCompletingId] = useState('')
  const [deletingId, setDeletingId] = useState('')

  const [newUser, setNewUser] = useState({ user_id: '', email: '', role: 'viewer' })
  const [newTask, setNewTask] = useState({
    tree_id: '',
    request_type: 'inspect',
    priority: 'med',
    due_at: '',
    notes: '',
    assignee_user_ids: [],
  })
  const [assignDraft, setAssignDraft] = useState({})

  const tasksApiConfigured = useMemo(() => mapApiEnv.userTasksUrl.trim().length > 0, [])

  const inputClass =
    'w-full rounded-xl bg-surface-container-high px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70'

  async function refreshAll() {
    if (!user || !tasksApiConfigured) return
    setIsLoading(true)
    setError('')
    setPartialWarning('')
    try {
      const data = await tasksApiRequest({ user, method: 'GET' })
      setUsers(Array.isArray(data.users) ? data.users : [])
      setTasks(Array.isArray(data.tasks) ? data.tasks : [])
      if (data.errors && typeof data.errors === 'object') {
        const parts = Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`)
        if (parts.length) setPartialWarning(parts.join(' | '))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user || !tasksApiConfigured) return
    void refreshAll()
  }, [authLoading, user, tasksApiConfigured])

  async function onCreateUser(event) {
    event.preventDefault()
    if (!user || createUserPending) return
    setError('')
    setCreateUserPending(true)
    try {
      await tasksApiRequest({
        user,
        method: 'POST',
        body: { action: 'create_user', ...newUser },
      })
      setNewUser({ user_id: '', email: '', role: 'viewer' })
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreateUserPending(false)
    }
  }

  async function onCreateTask(event) {
    event.preventDefault()
    if (!user || createTaskPending) return
    setError('')
    setTaskFlash('')
    setCreateTaskPending(true)
    try {
      await tasksApiRequest({
        user,
        method: 'POST',
        body: { action: 'create_task', ...newTask },
      })
      setNewTask({
        tree_id: '',
        request_type: 'inspect',
        priority: 'med',
        due_at: '',
        notes: '',
        assignee_user_ids: [],
      })
      setTaskFlash('Task created.')
      window.setTimeout(() => setTaskFlash(''), 4000)
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreateTaskPending(false)
    }
  }

  async function onSaveTaskAssignments(serviceRequestId) {
    if (!user || savingAssignId) return
    setError('')
    setSavingAssignId(serviceRequestId)
    try {
      await tasksApiRequest({
        user,
        method: 'POST',
        body: {
          action: 'assign_users',
          service_request_id: serviceRequestId,
          assignee_user_ids: assignDraft[serviceRequestId] || [],
        },
      })
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingAssignId('')
    }
  }

  async function onCompleteTask(serviceRequestId) {
    if (!user || completingId) return
    if (
      !window.confirm(
        'Mark this task as completed? This sets status to completed and records completion time.'
      )
    ) {
      return
    }
    setError('')
    setCompletingId(serviceRequestId)
    try {
      await tasksApiRequest({
        user,
        method: 'POST',
        body: { action: 'complete_task', service_request_id: serviceRequestId },
      })
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCompletingId('')
    }
  }

  async function onDeleteTask(serviceRequestId) {
    if (!user || deletingId) return
    if (
      !window.confirm(
        'Delete this task permanently? Assignments will be removed. This cannot be undone.'
      )
    ) {
      return
    }
    setError('')
    setDeletingId(serviceRequestId)
    try {
      await tasksApiRequest({
        user,
        method: 'POST',
        body: { action: 'delete_task', service_request_id: serviceRequestId },
      })
      setAssignDraft((prev) => {
        const next = { ...prev }
        delete next[serviceRequestId]
        return next
      })
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId('')
    }
  }

  function toggleSelected(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-on-surface">
      <AppNavbar />
      <div className="min-h-0 flex-1 overflow-auto bg-surface-container-low px-6 py-24">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <header className="rounded-2xl bg-surface-container-lowest p-6">
            <h1 className="text-3xl font-black tracking-tight text-on-surface">User Tasks</h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              Create users, create service tasks, and assign users to tasks. This tab is isolated to
              the user-task endpoint and does not affect other sections.
            </p>
            {!tasksApiConfigured ? (
              <p className="mt-3 text-sm text-error">
                Set `VITE_CF_USER_TASKS_API_URL` in `frontend/.env` to enable this page.
              </p>
            ) : null}
            {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
            {partialWarning ? (
              <p className="mt-2 text-sm text-amber-800">Partial load: {partialWarning}</p>
            ) : null}
            {taskFlash ? (
              <p className="mt-2 text-sm font-medium text-primary" role="status">
                {taskFlash}
              </p>
            ) : null}
          </header>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl bg-surface-container-lowest p-6">
              <h2 className="mb-4 text-lg font-bold text-on-surface">Create User</h2>
              <form className="space-y-3" onSubmit={onCreateUser}>
                <input
                  className={inputClass}
                  placeholder="User ID (Firebase UID)"
                  value={newUser.user_id}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, user_id: e.target.value }))}
                  required
                  disabled={createUserPending}
                />
                <input
                  className={inputClass}
                  placeholder="Email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
                  required
                  disabled={createUserPending}
                />
                <select
                  className={`${inputClass} disabled:opacity-60`}
                  value={newUser.role}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
                  disabled={createUserPending}
                >
                  <option value="viewer">viewer</option>
                  <option value="arborist">arborist</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  type="submit"
                  disabled={!tasksApiConfigured || !user || createUserPending}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {createUserPending ? <InlineSpinner /> : null}
                  {createUserPending ? 'Saving…' : 'Create / Update User'}
                </button>
              </form>
            </section>

            <section className="rounded-2xl bg-surface-container-lowest p-6">
              <h2 className="mb-4 text-lg font-bold text-on-surface">Create Task</h2>
              <form className="space-y-3" onSubmit={onCreateTask}>
                <input
                  className={inputClass}
                  placeholder="Tree ID"
                  value={newTask.tree_id}
                  onChange={(e) => setNewTask((prev) => ({ ...prev, tree_id: e.target.value }))}
                  required
                  disabled={createTaskPending}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className={`${inputClass} disabled:opacity-60`}
                    value={newTask.request_type}
                    onChange={(e) => setNewTask((prev) => ({ ...prev, request_type: e.target.value }))}
                    disabled={createTaskPending}
                  >
                    <option value="inspect">inspect</option>
                    <option value="prune">prune</option>
                    <option value="remove">remove</option>
                    <option value="plant">plant</option>
                    <option value="treat">treat</option>
                  </select>
                  <select
                    className={`${inputClass} disabled:opacity-60`}
                    value={newTask.priority}
                    onChange={(e) => setNewTask((prev) => ({ ...prev, priority: e.target.value }))}
                    disabled={createTaskPending}
                  >
                    <option value="low">low</option>
                    <option value="med">med</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={newTask.due_at}
                  onChange={(e) => setNewTask((prev) => ({ ...prev, due_at: e.target.value }))}
                  disabled={createTaskPending}
                />
                <textarea
                  className={inputClass}
                  placeholder="Notes"
                  value={newTask.notes}
                  onChange={(e) => setNewTask((prev) => ({ ...prev, notes: e.target.value }))}
                  disabled={createTaskPending}
                />
                <div className="rounded-xl bg-surface-container-high p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-on-surface-variant">
                    Assign Users
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {users.map((u) => (
                      <label
                        key={u.user_id}
                        className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-2 py-1 text-xs text-on-surface"
                      >
                        <input
                          type="checkbox"
                          checked={newTask.assignee_user_ids.includes(u.user_id)}
                          disabled={createTaskPending}
                          onChange={() =>
                            setNewTask((prev) => ({
                              ...prev,
                              assignee_user_ids: toggleSelected(prev.assignee_user_ids, u.user_id),
                            }))
                          }
                        />
                        <span>{u.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!tasksApiConfigured || !user || createTaskPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50 sm:w-auto"
                >
                  {createTaskPending ? <InlineSpinner /> : null}
                  {createTaskPending ? 'Creating task…' : 'Create Task'}
                </button>
              </form>
            </section>
          </div>

          <section className="rounded-2xl bg-surface-container-lowest p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-surface">Tasks</h2>
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={isLoading || !tasksApiConfigured || !user || authLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                {isLoading ? <InlineSpinner className="border-on-surface/20 border-t-on-surface" /> : null}
                {isLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-3">
              {tasks.map((task) => {
                const draft = assignDraft[task.service_request_id] || task.assignee_user_ids || []
                const isDone = String(task.status || '').toLowerCase() === 'completed'
                return (
                  <article
                    key={task.service_request_id}
                    className="rounded-xl bg-surface-container-low p-4 text-on-surface"
                  >
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-bold">{task.request_type}</span>
                      <span className="rounded bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
                        {task.priority}
                      </span>
                      <span className="rounded bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
                        {task.status || '—'}
                      </span>
                      <span className="text-on-surface-variant">Tree: {task.tree_id}</span>
                      <span className="text-on-surface-variant">Task ID: {task.service_request_id}</span>
                    </div>
                    <p className="mt-2 text-sm text-on-surface-variant">{task.notes || 'No notes'}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {users.map((u) => (
                        <label
                          key={`${task.service_request_id}-${u.user_id}`}
                          className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={draft.includes(u.user_id)}
                            disabled={Boolean(savingAssignId) || isDone}
                            onChange={() =>
                              setAssignDraft((prev) => ({
                                ...prev,
                                [task.service_request_id]: toggleSelected(draft, u.user_id),
                              }))
                            }
                          />
                          <span>{u.email}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onSaveTaskAssignments(task.service_request_id)}
                        disabled={
                          !tasksApiConfigured || !user || savingAssignId === task.service_request_id || isDone
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {savingAssignId === task.service_request_id ? (
                          <InlineSpinner className="border-on-surface/20 border-t-on-surface" />
                        ) : null}
                        {savingAssignId === task.service_request_id ? 'Saving…' : 'Save Assignments'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onCompleteTask(task.service_request_id)}
                        disabled={
                          !tasksApiConfigured || !user || isDone || completingId === task.service_request_id
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-secondary-container px-3 py-1.5 text-xs font-semibold text-on-secondary-container disabled:opacity-50"
                      >
                        {completingId === task.service_request_id ? <InlineSpinner /> : null}
                        {isDone ? 'Completed' : completingId === task.service_request_id ? 'Completing…' : 'Complete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteTask(task.service_request_id)}
                        disabled={!tasksApiConfigured || !user || deletingId === task.service_request_id}
                        className="inline-flex items-center gap-2 rounded-lg bg-error-container/80 px-3 py-1.5 text-xs font-semibold text-error disabled:opacity-50"
                      >
                        {deletingId === task.service_request_id ? <InlineSpinner /> : null}
                        {deletingId === task.service_request_id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </article>
                )
              })}
              {!tasks.length ? (
                <p className="text-sm text-on-surface-variant">No tasks yet.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
