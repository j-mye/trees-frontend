/** @typedef {{
 *   k1Multiplier: number
 *   k3Multiplier: number
 *   topCriticalPercent: number
 *   usePercentileColors: boolean
 *   colorPercentileLow: number
 *   colorPercentileHigh: number
 * }} PriorityTuning */

export const DEFAULT_PRIORITY_TUNING = /** @type {PriorityTuning} */ ({
  k1Multiplier: 1.0,
  k3Multiplier: 1.0,
  topCriticalPercent: 10,
  usePercentileColors: true,
  colorPercentileLow: 20,
  colorPercentileHigh: 80,
})

/**
 * Tuned section pressure from qs_priority (absolute — not 0–100).
 * @param {Record<string, unknown> | null | undefined} properties
 * @param {PriorityTuning} tuning
 */
export function computeQsPsComposite(properties, tuning) {
  const psComposite = Number(properties?.PS_composite) || 0
  const psCritical = Number(properties?.PS_critical) || 0
  if (psComposite <= 0) return 0

  const sway = Math.max(0, Math.min(1, tuning.topCriticalPercent / 100))
  let blended = psComposite
  if (psCritical > 0 && sway > 0) {
    blended = (1 - sway) * psComposite + sway * psCritical
  }
  const kBlend = tuning.k1Multiplier * 0.65 + tuning.k3Multiplier * 0.35
  return blended * kBlend
}

/**
 * @param {Record<string, unknown> | null | undefined} properties
 * @param {PriorityTuning} tuning
 */
export function computeQsColorScore(properties, tuning) {
  return computeQsPsComposite(properties, tuning)
}

/**
 * Where a value falls within a sorted cohort (0–100).
 * @param {number[]} sortedAsc
 * @param {number} value
 */
export function percentileOfValue(sortedAsc, value) {
  if (!sortedAsc.length || !Number.isFinite(value) || value <= 0) return 0
  let less = 0
  let equal = 0
  for (const v of sortedAsc) {
    if (v < value) less += 1
    else if (v === value) equal += 1
  }
  return ((less + equal * 0.5) / sortedAsc.length) * 100
}

/** Priority band from cohort percentile within the loaded/filtered set. */
export function priorityLevelFromCohortPercentile(percentile) {
  const p = Number(percentile) || 0
  if (p >= 90) return 'Critical'
  if (p >= 70) return 'High'
  if (p >= 40) return 'Medium'
  return 'Low'
}

/**
 * @param {number | null | undefined} value
 */
export function formatPsComposite(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 100) return n.toFixed(1)
  if (n >= 10) return n.toFixed(2)
  return n.toFixed(3)
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function enrichPruneQueueRowsWithPsMetrics(rows) {
  const psValues = rows
    .map((r) => Number(r.psComposite))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)

  return rows.map((row) => {
    const pct = percentileOfValue(psValues, Number(row.psComposite) || 0)
    return {
      ...row,
      psPercentile: pct,
      relativeLevel: priorityLevelFromCohortPercentile(pct),
    }
  })
}

/**
 * @param {import('geojson').FeatureCollection | null | undefined} geojson
 * @param {PriorityTuning} tuning
 */
export function applyPriorityTuningToGeojson(geojson, tuning) {
  if (!geojson?.features) return geojson

  const psValues = geojson.features
    .map((f) => computeQsPsComposite(f.properties, tuning))
    .filter((v) => v > 0)
    .sort((a, b) => a - b)

  return {
    ...geojson,
    features: geojson.features.map((f) => {
      const p = f.properties || {}
      const psComposite = computeQsPsComposite(p, tuning)
      const colorPercentile = percentileOfValue(psValues, psComposite)
      return {
        ...f,
        properties: {
          ...p,
          _psCompositeDisplay: psComposite,
          _colorScore: psComposite,
          _colorPercentile: colorPercentile,
          _map_level: priorityLevelFromCohortPercentile(colorPercentile),
        },
      }
    }),
  }
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {(f: import('geojson').Feature) => boolean} [matchesFilter]
 * @param {PriorityTuning} tuning
 */
export function computePriorityFactorBreakdown(features, matchesFilter, tuning) {
  const rows = Array.isArray(features) ? features : []
  let trees = 0
  let wIf = 0
  let wPf = 0
  let wAp = 0
  let wRisk = 0
  let wAge = 0

  for (const f of rows) {
    if (matchesFilter && !matchesFilter(f)) continue
    const p = f.properties || {}
    const tc = Number(p.tree_count ?? p.total_trees ?? 0) || 0
    if (tc <= 0) continue
    trees += tc
    wIf += (Number(p.avg_i_f) || 0) * tc
    wPf += (Number(p.avg_p_f) || 0) * tc
    wAp += (Number(p.avg_a_p) || 0) * tc
    wRisk += (Number(p.avg_risk_term) || 0) * tc
    wAge += (Number(p.avg_age_term) || 0) * tc
  }

  if (trees <= 0) {
    return { treeCount: 0, hasFactorData: false, segments: [], tunedDisplayScore: null }
  }

  const avgIf = wIf / trees
  const avgPf = wPf / trees
  const avgAp = wAp / trees
  const avgRisk = wRisk / trees
  const avgAge = wAge / trees

  const riskMag = tuning.k1Multiplier * (avgRisk > 0 ? avgRisk : avgIf * avgPf)
  const ageMag = tuning.k3Multiplier * (avgAge > 0 ? avgAge : avgAp)
  const total = riskMag + ageMag

  /** @type {{ key: string, label: string, share: number, value: number }[]} */
  const segments =
    total > 0
      ? [
          {
            key: 'i_f',
            label: 'Impact of failure (I_f)',
            share: (riskMag * 0.5) / total,
            value: avgIf,
          },
          {
            key: 'p_f',
            label: 'Probability of failure (p_f)',
            share: (riskMag * 0.5) / total,
            value: avgPf,
          },
          {
            key: 'a_p',
            label: 'Age prioritization (a_p)',
            share: ageMag / total,
            value: avgAp,
          },
        ]
      : [
          { key: 'i_f', label: 'Impact of failure (I_f)', share: 1 / 3, value: avgIf },
          { key: 'p_f', label: 'Probability of failure (p_f)', share: 1 / 3, value: avgPf },
          { key: 'a_p', label: 'Age prioritization (a_p)', share: 1 / 3, value: avgAp },
        ]

  return {
    treeCount: trees,
    hasFactorData: avgRisk > 0 || avgAge > 0 || avgIf > 0 || avgPf > 0 || avgAp > 0,
    segments,
    riskMag,
    ageMag,
  }
}
