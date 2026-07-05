import { DEFAULT_PRIORITY_TUNING } from '../../utils/priorityModel.js'

const SEGMENT_COLORS = {
  i_f: '#4f46e5',
  p_f: '#0891b2',
  a_p: '#059669',
}

/**
 * @param {object} props
 * @param {import('../../utils/priorityModel.js').PriorityTuning} props.tuning
 * @param {(next: import('../../utils/priorityModel.js').PriorityTuning) => void} props.onTuningChange
 * @param {ReturnType<import('../../utils/priorityModel.js').computePriorityFactorBreakdown> | null} props.breakdown
 */
export function PriorityTuningPanel({ tuning, onTuningChange, breakdown }) {
  const setField = (key, value) => onTuningChange({ ...tuning, [key]: value })

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          Priority score factors
        </h3>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
          onClick={() => onTuningChange({ ...DEFAULT_PRIORITY_TUNING })}
        >
          Reset
        </button>
      </div>

      <p className="text-[11px] leading-snug text-slate-600">
        Map colors and the prune list use <strong>PS composite</strong> (section pressure), scaled within
        the loaded data. Sliders retune risk, age, and critical-tree sway client-side.
      </p>

      {!breakdown?.hasFactorData ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          Factor averages are not in the map payload yet. Redeploy{' '}
          <code className="rounded bg-amber-100 px-1 text-[10px]">getQuarterSectionSummaries</code> to
          load I_f / p_f / a_p rollups.
        </p>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-200/80">
            {breakdown.segments.map((seg) => (
              <div
                key={seg.key}
                className="h-full transition-all duration-200"
                style={{
                  width: `${Math.max(0, seg.share * 100)}%`,
                  backgroundColor: SEGMENT_COLORS[seg.key] ?? '#94a3b8',
                }}
                title={`${seg.label}: ${(seg.share * 100).toFixed(0)}%`}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            {breakdown.segments.map((seg) => (
              <div key={seg.key} className="flex items-center gap-2 text-[11px] text-slate-700">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SEGMENT_COLORS[seg.key] ?? '#94a3b8' }}
                />
                <span className="min-w-0 flex-1 leading-snug">{seg.label}</span>
                <span className="shrink-0 font-mono tabular-nums text-slate-500">
                  {(seg.share * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <label className="block">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>k1 — risk (I_f × p_f)</span>
            <span className="text-indigo-600">{tuning.k1Multiplier.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={tuning.k1Multiplier}
            onChange={(e) => setField('k1Multiplier', Number(e.target.value))}
            className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
          />
        </label>

        <label className="block">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>k3 — age (a_p)</span>
            <span className="text-indigo-600">{tuning.k3Multiplier.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={tuning.k3Multiplier}
            onChange={(e) => setField('k3Multiplier', Number(e.target.value))}
            className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
          />
        </label>

        <label className="block">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
            <span>Top X% critical sway</span>
            <span className="text-indigo-600">{tuning.topCriticalPercent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={tuning.topCriticalPercent}
            onChange={(e) => setField('topCriticalPercent', Number(e.target.value))}
            className="w-full accent-indigo-600 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer"
          />
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 cursor-pointer transition-colors hover:bg-slate-100">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300 accent-indigo-600 focus:ring-indigo-600 w-4 h-4"
            checked={tuning.usePercentileColors}
            onChange={(e) => setField('usePercentileColors', e.target.checked)}
          />
          <span className="text-[11px] leading-snug text-slate-700">
            Soften red skew (P{tuning.colorPercentileLow}–P{tuning.colorPercentileHigh} bounds; orange/red weighted scale)
          </span>
        </label>
      </div>
    </section>
  )
}
