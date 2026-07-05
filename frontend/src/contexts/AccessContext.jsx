import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
/* eslint-disable react-refresh/only-export-components */
import { useAuth } from './AuthContext.jsx'
import {
  fetchAccessMe,
  isAccessApiConfigured,
  registerAccessRequest,
} from '../access/accessApi.js'

const AccessContext = createContext(null)

export function AccessProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState(null)
  const [isApproved, setIsApproved] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setIsApproved(false)
      setIsAdmin(false)
      setApprovalRequired(false)
      setError(null)
      setLoading(false)
      return
    }
    if (!isAccessApiConfigured()) {
      setProfile(null)
      setIsApproved(true)
      setIsAdmin(false)
      setApprovalRequired(false)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAccessMe(user)
      setProfile(data.profile ?? null)
      setIsApproved(Boolean(data.is_approved))
      setIsAdmin(Boolean(data.is_admin))
      setApprovalRequired(Boolean(data.approval_required))
    } catch (e) {
      setProfile(null)
      setIsApproved(false)
      setIsAdmin(false)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    refresh()
  }, [authLoading, refresh])

  const submitRegistration = useCallback(
    async (payload) => {
      if (!user) throw new Error('Sign in required')
      const data = await registerAccessRequest(user, payload)
      await refresh()
      return data
    },
    [user, refresh],
  )

  const value = useMemo(
    () => ({
      profile,
      isApproved,
      isAdmin,
      approvalRequired,
      loading: authLoading || loading,
      error,
      refresh,
      submitRegistration,
      accessApiConfigured: isAccessApiConfigured(),
    }),
    [
      profile,
      isApproved,
      isAdmin,
      approvalRequired,
      authLoading,
      loading,
      error,
      refresh,
      submitRegistration,
    ],
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess() {
  const ctx = useContext(AccessContext)
  if (!ctx) {
    throw new Error('useAccess must be used within AccessProvider')
  }
  return ctx
}
