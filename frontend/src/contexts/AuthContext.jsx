import { createContext, useContext, useEffect, useMemo, useState } from 'react'
/* eslint-disable react-refresh/only-export-components -- paired provider + hook module */
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase.js'

const AuthContext = createContext(null)

function requireAuth() {
  const auth = getFirebaseAuth()
  if (!auth) {
    throw new Error('Firebase is not configured. Add VITE_FIREBASE_* to .env.')
  }
  return auth
}

export function AuthProvider({ children }) {
  const firebaseConfigured = isFirebaseConfigured()
  const auth = getFirebaseAuth()

  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => auth != null)

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [auth])

  const effectiveUser = auth ? user : null
  const effectiveLoading = auth ? loading : false

  const value = useMemo(() => {
    async function logout() {
      const auth = getFirebaseAuth()
      if (auth) await signOut(auth)
    }

    async function login(email, password, rememberMe = true) {
      const auth = requireAuth()
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence,
      )
      await signInWithEmailAndPassword(auth, email.trim(), password)
    }

    async function signup(email, password, rememberMe = true) {
      const auth = requireAuth()
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence,
      )
      await createUserWithEmailAndPassword(auth, email.trim(), password)
    }

    return {
      user: effectiveUser,
      loading: effectiveLoading,
      firebaseConfigured,
      login,
      signup,
      logout,
      /** @deprecated Use `logout` */
      signOutUser: logout,

      async signInWithGoogle() {
        const auth = requireAuth()
        const provider = new GoogleAuthProvider()
        await signInWithPopup(auth, provider)
      },

      /** @deprecated Use `login` */
      signInWithEmailPassword: login,

      async sendPasswordReset(email) {
        const auth = requireAuth()
        await sendPasswordResetEmail(auth, email.trim())
      },

      async getIdToken() {
        const auth = getFirebaseAuth()
        const u = auth?.currentUser
        if (!u) return null
        return u.getIdToken()
      },
    }
  }, [effectiveUser, effectiveLoading, firebaseConfigured])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
