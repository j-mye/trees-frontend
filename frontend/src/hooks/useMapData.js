import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { getFirebaseAuth } from '../firebase.js'

/**
 * @typedef {object} QuarterSectionProperties
 * @property {number} OBJECTID
 * @property {string} QTRSEC
 * @property {string} qs_id
 * @property {number} Priority_Score_Normalized
 * @property {number} PS_critical
 * @property {number} PS_bottom90
 * @property {number} PS_background
 * @property {number} PS_composite
 * @property {string} priority_level
 */

/**
 * @typedef {object} TreePriorityRow
 * @property {string} tree_row_id
 * @property {number} priority_score
 * @property {number} risk_term_k1_I_f_p_f_b
 * @property {number} age_term_k3_a_p
 * @property {number} age
 * @property {number} maintenance_deficit
 * @property {number} years_since_pruned
 * @property {boolean} can_strike_building
 * @property {number} crown_diameter_m
 * @property {string} condition_aerial
 * @property {string} missing_or_dead
 */

/**
 * Summaries-only initial load + lazy per-QS tree fetch with in-memory cache (no duplicate fetches).
 */
export function useMapData() {
  const [data, setData] = useState(null)
  const [cachedTrees, setCachedTrees] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  const summariesUrl = import.meta.env.VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL
  const treesUrl = import.meta.env.VITE_CF_GET_TREES_BY_QS_URL

  const inflightTrees = useRef(new Map())
  const cachedTreesRef = useRef({})

  useEffect(() => {
    cachedTreesRef.current = cachedTrees
  }, [cachedTrees])

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) {
      setError(new Error('Firebase is not configured'))
      setData(null)
      setIsLoading(false)
      return undefined
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!summariesUrl || String(summariesUrl).trim() === '') {
        setError(
          new Error(
            'VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL is not set. Add it to .env (see .env.example).'
          )
        )
        setData(null)
        setIsLoading(false)
        return
      }

      if (!user) {
        setError(new Error('Sign in required'))
        setData(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const token = await user.getIdToken()
        const res = await fetch(summariesUrl, {
          method: 'GET',
          credentials: 'omit',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(
            `Map summaries request failed (${res.status}): ${errBody.slice(0, 200)}`
          )
        }
        const json = await res.json()
        if (!json.geojson || !json.summary) {
          throw new Error('Invalid response: expected geojson and summary')
        }
        const treePoints = Array.isArray(json.tree_points) ? json.tree_points : []
        setData({ ...json, tree_points: treePoints })
        setCachedTrees({})
        cachedTreesRef.current = {}
        inflightTrees.current.clear()
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
        setData(null)
      } finally {
        setIsLoading(false)
      }
    })
    return () => unsub()
  }, [summariesUrl])

  const fetchTreesByQs = useCallback(async (qsId) => {
    const key = String(qsId)
    if (!treesUrl || String(treesUrl).trim() === '') {
      throw new Error(
        'VITE_CF_GET_TREES_BY_QS_URL is not set. Add it to .env (see .env.example).'
      )
    }
    const auth = getFirebaseAuth()
    const user = auth?.currentUser
    if (!user) {
      throw new Error('Sign in required')
    }

    const hit = cachedTreesRef.current[key]
    if (hit) {
      return hit
    }

    const pending = inflightTrees.current.get(key)
    if (pending) {
      return pending
    }

    const promise = (async () => {
      const token = await user.getIdToken()
      const sep = treesUrl.includes('?') ? '&' : '?'
      const url = `${treesUrl}${sep}qs_id=${encodeURIComponent(key)}`
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Trees request failed (${res.status}): ${errBody.slice(0, 200)}`)
      }
      const json = await res.json()
      const trees = Array.isArray(json.trees) ? json.trees : []
      setCachedTrees((prev) => ({ ...prev, [key]: trees }))
      cachedTreesRef.current = { ...cachedTreesRef.current, [key]: trees }
      return trees
    })()

    inflightTrees.current.set(key, promise)
    try {
      return await promise
    } finally {
      inflightTrees.current.delete(key)
    }
  }, [treesUrl])

  const refetch = useCallback(async () => {
    const auth = getFirebaseAuth()
    const user = auth?.currentUser
    if (!user || !summariesUrl) return
    setIsLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(summariesUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const treePoints = Array.isArray(json.tree_points) ? json.tree_points : []
      setData({ ...json, tree_points: treePoints })
      setCachedTrees({})
      cachedTreesRef.current = {}
      inflightTrees.current.clear()
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  }, [summariesUrl])

  return {
    data,
    cachedTrees,
    fetchTreesByQs,
    isLoading,
    error,
    refetch,
  }
}

/** Build a GeoJSON FeatureCollection of Point features for tree markers. */
export function treePointsToGeoJSON(treePoints) {
  if (!Array.isArray(treePoints)) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: treePoints.map((p, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        dbh: p.dbh,
        condition: p.condition,
        quarter_section: p.quarter_section,
        species: p.species,
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lon, p.lat],
      },
    })),
  }
}
