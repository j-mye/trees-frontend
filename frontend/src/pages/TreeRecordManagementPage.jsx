import { useCallback, useEffect, useMemo, useState } from 'react'
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

async function treesDataRequest({ user, method = 'GET', query = '', body = null }) {
  const token = await user.getIdToken()
  const base = mapApiEnv.treesDataUrl.replace(/\/$/, '')
  const url = query ? `${base}?${query}` : base
  const res = await fetch(url, {
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
    throw new Error(`Expected JSON (${res.status})`)
  }
  if (!res.ok) {
    const detail = json?.message || json?.error || json?.detail
    throw new Error(detail ? String(detail) : `Request failed (${res.status})`)
  }
  return json
}

function emptyForm() {
  return {
    tree_id: '',
    qs_id: '',
    latitude: '',
    longitude: '',
    dbh: '',
    height: '',
    species_id: '',
    condition_aerial: 'Unknown',
    inventory_date: '',
    years_since_pruned: '0',
    maintenance_deficit: '0',
    age: '',
    can_strike_building: false,
    crown_diameter_m: '',
    missing_or_dead: '',
    status: 'Active',
  }
}

function treeToForm(t) {
  return {
    tree_id: t.tree_id != null ? String(t.tree_id) : '',
    qs_id: t.qs_id != null ? String(t.qs_id) : '',
    latitude: t.latitude != null && Number.isFinite(t.latitude) ? String(t.latitude) : '',
    longitude: t.longitude != null && Number.isFinite(t.longitude) ? String(t.longitude) : '',
    dbh: t.dbh != null && Number.isFinite(t.dbh) ? String(t.dbh) : '',
    height: t.height != null && Number.isFinite(t.height) ? String(t.height) : '',
    species_id: t.species_id != null ? String(t.species_id) : '',
    condition_aerial: t.condition_aerial != null ? String(t.condition_aerial) : 'Unknown',
    inventory_date: t.inventory_date != null ? String(t.inventory_date) : '',
    years_since_pruned:
      t.years_since_pruned != null && Number.isFinite(t.years_since_pruned)
        ? String(t.years_since_pruned)
        : '0',
    maintenance_deficit:
      t.maintenance_deficit != null && Number.isFinite(t.maintenance_deficit)
        ? String(t.maintenance_deficit)
        : '0',
    age: t.age != null && Number.isFinite(t.age) ? String(t.age) : '',
    can_strike_building: Boolean(t.can_strike_building),
    crown_diameter_m:
      t.crown_diameter_m != null && Number.isFinite(t.crown_diameter_m) ? String(t.crown_diameter_m) : '',
    missing_or_dead: t.missing_or_dead != null ? String(t.missing_or_dead) : '',
    status: t.status != null && String(t.status).trim() !== '' ? String(t.status) : 'Active',
  }
}

export default function TreeRecordManagementPage() {
  const { user, loading: authLoading } = useAuth()
  const apiConfigured = useMemo(() => mapApiEnv.treesDataUrl.trim().length > 0, [])

  const [mode, setMode] = useState(/** @type {'edit' | 'create'} */ ('edit'))
  const [species, setSpecies] = useState(/** @type {{ species_id: number, label: string }[]} */ ([]))
  const [form, setForm] = useState(emptyForm)
  const [speciesLabel, setSpeciesLabel] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loadIdInput, setLoadIdInput] = useState('')
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingSpecies, setLoadingSpecies] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const inputClass =
    'w-full rounded-xl bg-surface-container-high px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70'

  const loadSpecies = useCallback(async () => {
    if (!user || !apiConfigured) return
    setLoadingSpecies(true)
    setError('')
    try {
      const data = await treesDataRequest({
        user,
        method: 'GET',
        query: 'mode=species&limit=1200',
      })
      setSpecies(Array.isArray(data.species) ? data.species : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSpecies([])
    } finally {
      setLoadingSpecies(false)
    }
  }, [apiConfigured, user])

  useEffect(() => {
    if (authLoading || !user || !apiConfigured) return
    void loadSpecies()
  }, [authLoading, user, apiConfigured, loadSpecies])

  async function onLoadTree(e) {
    e.preventDefault()
    if (!user || !apiConfigured) return
    const id = loadIdInput.trim()
    if (!id) {
      setError('Enter a tree id to load.')
      return
    }
    setLoadingTree(true)
    setError('')
    setSuccess('')
    try {
      const data = await treesDataRequest({
        user,
        method: 'GET',
        query: `tree_id=${encodeURIComponent(id)}`,
      })
      const t = data?.tree
      if (!t || typeof t !== 'object') {
        throw new Error('Response missing tree')
      }
      setForm(treeToForm(t))
      setSpeciesLabel(t.species_label != null ? String(t.species_label) : '')
      setMode('edit')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingTree(false)
    }
  }

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function buildPayload() {
    const lat = Number(form.latitude)
    const lon = Number(form.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('Latitude and longitude must be valid numbers.')
    }
    const dbh = Number(form.dbh)
    if (!Number.isFinite(dbh)) {
      throw new Error('DBH must be a number.')
    }
    const speciesRaw = form.species_id.trim()
    const species_id = speciesRaw === '' ? null : Number(speciesRaw)
    if (species_id !== null && !Number.isFinite(species_id)) {
      throw new Error('Species must be chosen from the list (numeric id).')
    }
    const heightStr = form.height.trim()
    const height = heightStr === '' ? null : Number(heightStr)
    if (heightStr !== '' && !Number.isFinite(height)) {
      throw new Error('Height must be a number or empty.')
    }
    const ageStr = form.age.trim()
    const age = ageStr === '' ? null : Number(ageStr)
    if (ageStr !== '' && !Number.isFinite(age)) {
      throw new Error('Age must be a number or empty.')
    }
    const crownStr = form.crown_diameter_m.trim()
    const crown_diameter_m = crownStr === '' ? 0 : Number(crownStr)
    if (crownStr !== '' && !Number.isFinite(crown_diameter_m)) {
      throw new Error('Crown diameter must be a number or empty.')
    }
    return {
      tree_id: form.tree_id.trim(),
      qs_id: form.qs_id.trim(),
      latitude: lat,
      longitude: lon,
      dbh,
      height,
      species_id,
      condition_aerial: form.condition_aerial.trim() || 'Unknown',
      inventory_date: form.inventory_date.trim(),
      years_since_pruned: Number.parseInt(form.years_since_pruned, 10) || 0,
      maintenance_deficit: Number.parseInt(form.maintenance_deficit, 10) || 0,
      age: age ?? 0,
      can_strike_building: Boolean(form.can_strike_building),
      crown_diameter_m,
      missing_or_dead: form.missing_or_dead.trim(),
      status: form.status.trim(),
    }
  }

  async function onSave(e) {
    e.preventDefault()
    if (!user || !apiConfigured || saving) return
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const base = buildPayload()
      if (mode === 'create') {
        if (!base.species_id) {
          throw new Error('New trees require a species (inventory rule).')
        }
        const created = await treesDataRequest({
          user,
          method: 'POST',
          body: {
            action: 'create_tree',
            tree_id: base.tree_id || undefined,
            qs_id: base.qs_id,
            latitude: base.latitude,
            longitude: base.longitude,
            dbh: base.dbh,
            height: base.height,
            species_id: base.species_id,
            condition_aerial: base.condition_aerial,
            inventory_date: base.inventory_date,
            years_since_pruned: base.years_since_pruned,
            maintenance_deficit: base.maintenance_deficit,
            age: base.age,
            can_strike_building: base.can_strike_building,
            crown_diameter_m: base.crown_diameter_m,
            missing_or_dead: base.missing_or_dead,
            status: base.status || 'Active',
          },
        })
        const newId = created?.tree_id != null ? String(created.tree_id) : base.tree_id
        setSuccess('Tree created.')
        setMode('edit')
        if (newId) {
          setForm((prev) => ({ ...prev, tree_id: newId }))
          setLoadIdInput(newId)
        }
      } else {
        if (!base.tree_id) {
          throw new Error('tree_id is required to update.')
        }
        const body = {
          action: 'update_tree',
          tree_id: base.tree_id,
          qs_id: base.qs_id,
          latitude: base.latitude,
          longitude: base.longitude,
          dbh: base.dbh,
          height: base.height,
          condition_aerial: base.condition_aerial,
          inventory_date: base.inventory_date,
          years_since_pruned: base.years_since_pruned,
          maintenance_deficit: base.maintenance_deficit,
          age: base.age,
          can_strike_building: base.can_strike_building,
          crown_diameter_m: base.crown_diameter_m,
          missing_or_dead: base.missing_or_dead,
        }
        body.species_id = base.species_id
        if (base.status) {
          body.status = base.status
        }
        await treesDataRequest({ user, method: 'POST', body })
        setSuccess('Tree updated.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!user || !apiConfigured || deleting) return
    const id = form.tree_id.trim()
    if (!id) {
      setError('Load a tree before deleting.')
      return
    }
    if (
      !window.confirm(
        `Delete tree ${id} from inventory? This removes the row from trees_core (and trees_features if present). This cannot be undone.`
      )
    ) {
      return
    }
    setDeleting(true)
    setError('')
    setSuccess('')
    try {
      await treesDataRequest({
        user,
        method: 'POST',
        body: { action: 'delete_tree', tree_id: id },
      })
      setSuccess('Tree deleted.')
      setForm(emptyForm())
      setSpeciesLabel('')
      setLoadIdInput('')
      setMode('edit')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  function onNewTree() {
    setMode('create')
    setForm(emptyForm())
    setSpeciesLabel('')
    setLoadIdInput('')
    setError('')
    setSuccess('')
  }

  function onGenerateId() {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? `t-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        : `t-${Date.now().toString(36)}`
    setField('tree_id', id)
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-on-surface">
      <AppNavbar />
      <div className="min-h-0 flex-1 overflow-auto bg-surface-container-low px-6 py-24">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <header className="rounded-2xl bg-surface-container-lowest p-6">
            <h1 className="text-3xl font-black tracking-tight text-on-surface">Data management</h1>
            {!apiConfigured ? (
              <p className="mt-3 text-sm text-error">
                Set <code className="rounded bg-surface-container-high px-1">VITE_CF_TREES_DATA_API_URL</code> in{' '}
                <code className="rounded bg-surface-container-high px-1">frontend/.env</code> to the deployed
                function URL (same pattern as user tasks).
              </p>
            ) : null}
            {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
            {success ? (
              <p className="mt-3 text-sm font-medium text-primary" role="status">
                {success}
              </p>
            ) : null}
          </header>

          <section className="rounded-2xl bg-surface-container-lowest p-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Mode</span>
              <div className="inline-flex rounded-xl bg-surface-container-high p-0.5">
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                    mode === 'edit' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'
                  }`}
                  onClick={() => setMode('edit')}
                >
                  Edit existing
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                    mode === 'create' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'
                  }`}
                  onClick={onNewTree}
                >
                  New tree
                </button>
              </div>
            </div>

            {mode === 'edit' ? (
              <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={onLoadTree}>
                <div className="min-w-[200px] flex-1">
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    Tree id
                  </label>
                  <input
                    className={inputClass}
                    value={loadIdInput}
                    onChange={(e) => setLoadIdInput(e.target.value)}
                    placeholder="Existing tree_id"
                    disabled={!apiConfigured || loadingTree}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!apiConfigured || !user || loadingTree}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {loadingTree ? <InlineSpinner /> : null}
                  {loadingTree ? 'Loading…' : 'Load'}
                </button>
              </form>
            ) : null}

            <form className="space-y-4" onSubmit={onSave}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    tree_id {mode === 'create' ? '(optional)' : ''}
                  </label>
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} min-w-0 flex-1`}
                      value={form.tree_id}
                      onChange={(e) => setField('tree_id', e.target.value)}
                      placeholder={mode === 'create' ? 'Leave blank to auto-assign' : ''}
                      disabled={!apiConfigured}
                    />
                    {mode === 'create' ? (
                      <button
                        type="button"
                        onClick={onGenerateId}
                        className="shrink-0 rounded-xl border border-outline-variant/30 px-3 py-2 text-xs font-bold text-on-surface"
                      >
                        Generate
                      </button>
                    ) : null}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">qs_id</label>
                  <input
                    className={inputClass}
                    value={form.qs_id}
                    onChange={(e) => setField('qs_id', e.target.value)}
                    required
                    disabled={!apiConfigured}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    latitude
                  </label>
                  <input
                    className={inputClass}
                    value={form.latitude}
                    onChange={(e) => setField('latitude', e.target.value)}
                    inputMode="decimal"
                    required
                    disabled={!apiConfigured}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    longitude
                  </label>
                  <input
                    className={inputClass}
                    value={form.longitude}
                    onChange={(e) => setField('longitude', e.target.value)}
                    inputMode="decimal"
                    required
                    disabled={!apiConfigured}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">dbh</label>
                  <input
                    className={inputClass}
                    value={form.dbh}
                    onChange={(e) => setField('dbh', e.target.value)}
                    inputMode="decimal"
                    required
                    disabled={!apiConfigured}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    height (ft)
                  </label>
                  <input
                    className={inputClass}
                    value={form.height}
                    onChange={(e) => setField('height', e.target.value)}
                    inputMode="decimal"
                    placeholder="Optional"
                    disabled={!apiConfigured}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">species</label>
                <select
                  className={inputClass}
                  value={form.species_id}
                  onChange={(e) => setField('species_id', e.target.value)}
                  required={mode === 'create'}
                  disabled={!apiConfigured || loadingSpecies}
                >
                  <option value="">{mode === 'create' ? 'Select species…' : '— clear (NULL) —'}</option>
                  {species.map((s) => (
                    <option key={s.species_id} value={String(s.species_id)}>
                      {s.label} ({s.species_id})
                    </option>
                  ))}
                </select>
                {speciesLabel ? (
                  <p className="mt-1 text-xs text-on-surface-variant">Loaded label: {speciesLabel}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    condition_aerial
                  </label>
                  <input className={inputClass} value={form.condition_aerial} onChange={(e) => setField('condition_aerial', e.target.value)} disabled={!apiConfigured} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    inventory_date
                  </label>
                  <input className={inputClass} value={form.inventory_date} onChange={(e) => setField('inventory_date', e.target.value)} placeholder="e.g. 2024" disabled={!apiConfigured} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    years_since_pruned
                  </label>
                  <input className={inputClass} value={form.years_since_pruned} onChange={(e) => setField('years_since_pruned', e.target.value)} inputMode="numeric" disabled={!apiConfigured} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    maintenance_deficit
                  </label>
                  <input className={inputClass} value={form.maintenance_deficit} onChange={(e) => setField('maintenance_deficit', e.target.value)} inputMode="numeric" disabled={!apiConfigured} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">age</label>
                  <input className={inputClass} value={form.age} onChange={(e) => setField('age', e.target.value)} inputMode="decimal" placeholder="Optional" disabled={!apiConfigured} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                    crown_diameter_m
                  </label>
                  <input className={inputClass} value={form.crown_diameter_m} onChange={(e) => setField('crown_diameter_m', e.target.value)} inputMode="decimal" disabled={!apiConfigured} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-outline-variant accent-primary"
                    checked={form.can_strike_building}
                    onChange={(e) => setField('can_strike_building', e.target.checked)}
                    disabled={!apiConfigured}
                  />
                  can_strike_building
                </label>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                  missing_or_dead
                </label>
                <input className={inputClass} value={form.missing_or_dead} onChange={(e) => setField('missing_or_dead', e.target.value)} disabled={!apiConfigured} />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">status</label>
                <input className={inputClass} value={form.status} onChange={(e) => setField('status', e.target.value)} placeholder="Active" disabled={!apiConfigured} />
                <p className="mt-1 text-xs text-on-surface-variant">Leave blank on save (update only) to keep the current status in BigQuery.</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={!apiConfigured || !user || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-dim px-6 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                >
                  {saving ? <InlineSpinner /> : null}
                  {saving ? 'Saving…' : mode === 'create' ? 'Create tree' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={!apiConfigured || !user || deleting || mode === 'create' || !form.tree_id.trim()}
                  className="rounded-xl border border-error/40 px-6 py-2.5 text-sm font-bold text-error disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Delete tree'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
