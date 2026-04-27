import AppNavbar from '../components/AppNavbar.jsx'

export default function TreeRecordManagementPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <AppNavbar />
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-container-low pt-16">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4">
          <section className="mx-auto mb-4 w-full max-w-7xl shrink-0">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-2xl bg-surface-container-highest p-1">
                    <button
                      type="button"
                      className="rounded-xl bg-white px-8 py-3 text-sm font-bold text-primary shadow-sm transition-all"
                    >
                      Update Existing Tree
                    </button>
                    <button
                      type="button"
                      className="rounded-xl px-8 py-3 text-sm font-medium text-on-surface-variant transition-all hover:text-on-surface"
                    >
                      Plant New Tree
                    </button>
                  </div>
                </div>
                <div className="group relative max-w-2xl">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
                    search
                  </span>
                  <input
                    className="w-full rounded-2xl border-none bg-surface-container-lowest py-3 pl-12 pr-4 text-sm text-on-surface ring-1 ring-outline-variant/20 transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary"
                    placeholder="Search Site ID / Quarter Section (e.g., 45-B / NW-Q3)..."
                    type="text"
                  />
                </div>
              </div>
              <div className="hidden text-right xl:block">
                <h1 className="mb-1 text-3xl font-black leading-none tracking-tighter text-on-surface">
                  Record Management
                </h1>
                <p className="text-sm font-medium text-on-surface-variant">District 04 | Zone 12 Sector A</p>
              </div>
            </div>
          </section>
          <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-12 md:grid-rows-[minmax(0,1fr)_minmax(0,0.42fr)]">
            <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-full bg-surface-container-lowest md:col-span-8 md:row-start-1">
              <div className="shrink-0 p-4 pb-2">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                  <span className="material-symbols-outlined text-lg">location_on</span>
                  Geographic Placement
                </h3>
              </div>
              <div className="relative min-h-0 flex-1 bg-slate-200">
                <div
                  className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?q=80&w=1200&auto=format&fit=crop')] bg-cover bg-center"
                  data-location="Chicago"
                />
                <div className="absolute inset-0 bg-primary/5 mix-blend-multiply" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-12 w-12 rounded-full border-2 border-primary">
                    <div className="absolute left-0 top-1/2 h-[1px] w-full bg-primary" />
                    <div className="absolute left-1/2 top-0 h-full w-[1px] bg-primary" />
                  </div>
                </div>
                <div className="absolute bottom-4 right-4 space-y-2 rounded-xl border border-white/50 bg-white/90 p-3 shadow-lg backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold text-on-surface-variant">LAT</span>
                    <code className="font-mono text-xs font-bold text-primary">41.8781° N</code>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold text-on-surface-variant">LON</span>
                    <code className="font-mono text-xs font-bold text-primary">87.6298° W</code>
                  </div>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-3 p-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-on-surface-variant">Ward</label>
                  <select className="w-full rounded-lg border-none bg-surface-container-high text-xs font-medium focus:ring-2 focus:ring-primary">
                    <option>Ward 04</option>
                    <option>Ward 12</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-on-surface-variant">Land Use</label>
                  <select className="w-full rounded-lg border-none bg-surface-container-high text-xs font-medium focus:ring-2 focus:ring-primary">
                    <option>Residential</option>
                    <option>Commercial</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-on-surface-variant">Curbside</label>
                  <select className="w-full rounded-lg border-none bg-surface-container-high text-xs font-medium focus:ring-2 focus:ring-primary">
                    <option>Even Numbered</option>
                    <option>Odd Numbered</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-full bg-surface-container-lowest p-4 md:col-span-4 md:row-start-1">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <h3 className="mb-4 flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                  <span className="material-symbols-outlined text-lg">genetics</span>
                  Biological Data
                </h3>
                <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant">Species Catalog</label>
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border-none bg-surface-container-high py-2.5 pl-3 pr-10 text-xs font-bold"
                        type="text"
                        defaultValue="Quercus alba (White Oak)"
                        readOnly
                      />
                      <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                        search
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-on-surface-variant">DBH (inches)</label>
                      <input
                        className="w-full rounded-xl border-none bg-surface-container-high py-2.5 px-3 font-mono text-xs font-bold"
                        type="number"
                        defaultValue="24.5"
                        readOnly
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-on-surface-variant">Spread (ft)</label>
                      <input
                        className="w-full rounded-xl border-none bg-surface-container-high py-2.5 px-3 font-mono text-xs font-bold"
                        type="number"
                        defaultValue="42.0"
                        readOnly
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant">Pruning Cycle</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-primary py-2 text-[10px] font-bold text-on-primary"
                      >
                        5 YR
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-surface-container-high py-2 text-[10px] font-bold text-on-surface-variant hover:bg-slate-200"
                      >
                        7 YR
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-surface-container-high py-2 text-[10px] font-bold text-on-surface-variant hover:bg-slate-200"
                      >
                        10 YR
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-full bg-surface-container-lowest p-4 md:col-span-12 md:row-start-2">
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                  <span className="material-symbols-outlined text-lg">history_edu</span>
                  Audit Log & Notes
                </h3>
                <div className="flex gap-2">
                  <div className="rounded-lg bg-secondary-container px-3 py-1.5 text-xs font-bold text-on-secondary-container">
                    Last Audit: Oct 12, 2023
                  </div>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-2">
                <div className="shrink-0 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant">Current Status</label>
                    <select className="w-full rounded-xl border-none bg-surface-container-high py-2.5 px-3 text-xs font-bold text-on-surface">
                      <option>Healthy / Sustained</option>
                      <option>Stressed / Monitoring</option>
                      <option>Declining / Intervention</option>
                      <option>Dead / Removal Required</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant">Inspection Date</label>
                    <input
                      className="w-full rounded-xl border-none bg-surface-container-high py-2.5 px-3 text-xs font-bold text-on-surface"
                      type="date"
                      defaultValue="2023-11-24"
                    />
                  </div>
                </div>
                <div className="flex min-h-0 flex-col overflow-hidden md:flex-1">
                  <label className="mb-1 shrink-0 text-[10px] font-bold uppercase text-on-surface-variant">
                    Arborist Notes
                  </label>
                  <textarea
                    className="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-xl border-none bg-surface-container-high p-3 text-xs font-medium focus:ring-2 focus:ring-primary"
                    placeholder="Document structural integrity or unusual growth patterns..."
                    rows={1}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <footer className="flex w-full shrink-0 items-center justify-end border-t border-slate-100 bg-white/90 px-10 py-4 backdrop-blur-2xl">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="rounded-xl px-6 py-2.5 text-sm font-bold text-error transition-all hover:bg-error-container/10"
            >
              Delete Tree
            </button>
            <button
              type="button"
              className="rounded-xl bg-gradient-to-r from-primary to-primary-dim px-10 py-2.5 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Commit Record
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
