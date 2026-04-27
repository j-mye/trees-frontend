import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

const DEFAULT_LOGIN_REDIRECT = '/dashboard.html'

function isStaticHtmlPath(path) {
  return typeof path === 'string' && path.endsWith('.html')
}

export default function LoginPage() {
  const { user, loading, firebaseConfigured, login, signup, sendPasswordReset } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [err, setErr] = useState(null)
  const [pending, setPending] = useState(null)

  const from = location.state?.from || DEFAULT_LOGIN_REDIRECT

  useEffect(() => {
    if (!user || !isStaticHtmlPath(from)) return
    window.location.replace(from)
  }, [user, from])

  if (!firebaseConfigured) {
    return (
      <div className="bg-surface font-body text-on-surface flex h-[100vh] max-h-[100vh] min-h-0 items-center justify-center overflow-hidden p-6">
        <div className="ds-shadow-ambient w-full max-w-md rounded-xl bg-surface-container-low px-8 py-10 text-center min-h-0 max-h-full overflow-y-auto">
          <div className="rounded-lg bg-surface-container-lowest px-6 py-6">
            <h1 className="ds-headline-md">Sign-in unavailable</h1>
            <p className="ds-body-md mt-3 text-on-surface-variant">
              Firebase is not configured. Copy <code className="text-primary">.env.example</code> to{' '}
              <code className="text-primary">.env</code> and set the <code className="text-primary">VITE_FIREBASE_*</code>{' '}
              values from the Firebase console.
            </p>
            <p className="ds-body-md mt-6 text-on-surface-variant">
              You can still use the static dashboard at{' '}
              <a className="font-semibold text-primary hover:text-primary-dim" href="/dashboard.html">
                /dashboard.html
              </a>
              .
            </p>
            <Link
              className="mt-8 inline-block text-sm font-semibold text-primary hover:text-primary-dim"
              to="/"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="auth-bg flex h-[100vh] max-h-[100vh] min-h-0 items-center justify-center overflow-hidden bg-surface p-6 font-body text-on-surface">
        <p className="text-on-surface-variant">Loading…</p>
      </div>
    )
  }

  if (user) {
    if (isStaticHtmlPath(from)) {
      return (
        <div className="auth-bg flex h-[100vh] max-h-[100vh] min-h-0 items-center justify-center overflow-hidden bg-surface p-6 font-body text-on-surface">
          <p className="text-on-surface-variant">Opening dashboard…</p>
        </div>
      )
    }
    return <Navigate to={from} replace />
  }

  function redirectAfterAuth(dest) {
    if (isStaticHtmlPath(dest)) {
      window.location.assign(dest)
    } else {
      navigate(dest, { replace: true })
    }
  }

  const busy = pending !== null

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null)
    setPending('login')
    try {
      await login(email, password, rememberMe)
      redirectAfterAuth(from)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  async function onSignUp(e) {
    e.preventDefault()
    setErr(null)
    setPending('signup')
    try {
      await signup(email, password, rememberMe)
      redirectAfterAuth(from)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  async function onForgotPassword(e) {
    e.preventDefault()
    if (!email.trim()) {
      setErr('Enter your email address above, then try Forgot Password again.')
      return
    }
    setErr(null)
    setPending('reset')
    try {
      await sendPasswordReset(email)
      alert('If an account exists for that email, a reset link has been sent.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      className="bg-surface font-body text-on-surface min-h-screen flex items-center justify-center p-6 auth-bg"
      data-location="Milwaukee"
    >
      <main className="w-full max-w-md">
        {/* Central Login Card */}
        <div className="glass-panel border-none rounded-[1.5rem] shadow-2xl p-8 md:p-10 flex flex-col gap-8">

          {/* Branding Header */}
          <div className="flex flex-col items-center text-center gap-4">
            <div className="bg-purple-600 p-3 rounded-xl shadow-lg shadow-purple-600/30">
              <span className="material-symbols-outlined text-white text-3xl" data-icon="nature">
                nature
              </span>
            </div>
            <div>
              <h1 className="text-2xl !font-extrabold tracking-tight !text-gray-800 whitespace-nowrap">Pruning Planner</h1>
              <p className="text-[0.65rem] font-bold uppercase tracking-widest text-on-surface-variant mt-1">
                City of Milwaukee Municipal Forestry Portal
              </p>
            </div>
          </div>

          {/* Form Heading */}
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-gray-800">Sign In</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Enter your municipal credentials to access the ledger.
            </p>
          </div>

          {/* Login Form */}
          <form className="flex flex-col gap-5" onSubmit={onSubmit}>
            <div className="space-y-4">

              {/* Email Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-on-surface-variant ml-1" htmlFor="email">
                  Email Address
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-outline text-[1.25rem] group-focus-within:text-primary transition-colors" data-icon="mail">
                      mail
                    </span>
                  </div>
                  <input
                    className="block w-full pl-11 pr-4 py-3 bg-surface-container-high border-none rounded-xl text-on-surface placeholder:text-outline/60 focus:ring-0 focus:bg-white transition-all duration-200"
                    id="email"
                    name="email"
                    placeholder="name@milwaukee.gov"
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-primary transition-all duration-300 group-focus-within:w-full"></div>
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-on-surface-variant ml-1" htmlFor="password">
                  Password
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-outline text-[1.25rem] group-focus-within:text-primary transition-colors" data-icon="lock">
                      lock
                    </span>
                  </div>
                  <input
                    className="block w-full pl-11 pr-4 py-3 bg-surface-container-high border-none rounded-xl text-on-surface placeholder:text-outline/60 focus:ring-0 focus:bg-white transition-all duration-200"
                    id="password"
                    name="password"
                    placeholder="••••••••"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-primary transition-all duration-300 group-focus-within:w-full"></div>
                </div>
              </div>
            </div>

            {/* Utilities Row */}
            <div className="flex items-center justify-between px-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    className="peer h-4 w-4 rounded-lg border-outline-variant bg-surface-container text-primary focus:ring-primary focus:ring-offset-0 transition-colors"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={busy}
                  />
                </div>
                <span className="text-xs font-medium text-on-surface-variant group-hover:text-on-surface transition-colors">
                  Remember me
                </span>
              </label>
              <a
                className="text-xs font-bold text-primary hover:text-primary-dim transition-colors"
                href="#"
                onClick={onForgotPassword}
              >
                Forgot Password?
              </a>
            </div>

            {err && (
              <p className="text-center text-sm font-medium text-error" role="alert">
                {err}
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3 mt-4">
              <button
                className="w-full py-4 px-6 bg-gradient-to-r from-primary to-primary-dim text-on-primary font-bold rounded-xl shadow-lg shadow-primary/25 active:scale-[0.98] transition-all duration-200 disabled:opacity-60"
                type="submit"
                disabled={busy}
              >
                {pending === 'login' ? 'Signing in…' : 'Login to Portal'}
              </button>
              <button
                className="w-full py-3.5 px-6 bg-secondary-container text-on-secondary-container font-semibold rounded-xl hover:bg-secondary-container/80 transition-colors disabled:opacity-60"
                type="button"
                disabled={busy}
                onClick={onSignUp}
              >
                {pending === 'signup' ? 'Creating account…' : 'Request Access'}
              </button>
            </div>
          </form>

          {/* Footer Section within Card */}
          <div className="pt-8 border-t border-outline-variant/10 text-center">
            <p className="text-[0.65rem] font-medium text-outline uppercase tracking-widest">
              © 2026 Municipal Forestry Dept.
            </p>
            <div className="flex justify-center gap-4 mt-2">
              <a
                className="text-[0.65rem] font-bold text-on-surface-variant hover:text-primary transition-colors"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Privacy
              </a>
              <a
                className="text-[0.65rem] font-bold text-on-surface-variant hover:text-primary transition-colors"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Security
              </a>
              <a
                className="text-[0.65rem] font-bold text-on-surface-variant hover:text-primary transition-colors"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Help
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Background Image Descriptor */}
      <img
        className="hidden"
        data-alt="High-angle grayscale satellite view of perfectly aligned urban city blocks with dense green tree canopies along the streets, soft daylight, atmospheric perspective"
        src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdM4wltweKhEbelg_ZLge8TEpVhp5tkmuhYbduh0G7WnQb1_o4n_BVCsmAvqeSSEv4KtMGUY0zXF8d_V99wMsjhbiJEwu3VnoeAg2S-hRWO1B80ywByqCc_Ct5iFNPVEPCIkOidtlysJyG-DeTmgHfsFNO_zs-yZXhObyt7X8MlNpaLLKVnJ5VYYRvT_NNqkhhSNW8ZWYTf1eImYFRQtIxTjjxypGsDdjeqn13nymb9iU7lB1eoYt7_zRW_lnLACMQVnPFvn-dZ1AD"
        alt=""
      />
    </div>
  )
}