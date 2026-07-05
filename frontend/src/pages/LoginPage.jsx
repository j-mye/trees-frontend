import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import PostLoginRedirect from '../components/PostLoginRedirect.jsx'
import { LoginInfoModal } from '../components/login/LoginInfoModal.jsx'
import {
  LOGIN_LEGAL_LAST_UPDATED,
  LoginForgotPasswordContent,
  LoginHelpContent,
  LoginPrivacyPolicyContent,
  LoginSecurityTermsContent,
} from '../content/loginLegalCopy.jsx'
import { useAccess } from '../contexts/AccessContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

const DEFAULT_LOGIN_REDIRECT = '/dashboard'

/** @typedef {'privacy' | 'security' | 'help' | 'forgot-password'} LoginInfoModalKey */

const LOGIN_INFO_MODALS = /** @type {const} */ ({
  privacy: {
    title: 'Privacy Policy',
    Content: LoginPrivacyPolicyContent,
  },
  security: {
    title: 'Security & Terms of Use',
    Content: LoginSecurityTermsContent,
  },
  help: {
    title: 'Help & Support',
    Content: LoginHelpContent,
  },
  'forgot-password': {
    title: 'Password reset unavailable',
    Content: LoginForgotPasswordContent,
  },
})

/** Map legacy static paths to React Router routes after sign-in. */
function normalizeLoginRedirect(path) {
  if (path === '/dashboard.html') return '/dashboard'
  return path
}

function isStaticHtmlPath(path) {
  return typeof path === 'string' && path.endsWith('.html')
}

export default function LoginPage() {
  const { user, loading, firebaseConfigured, login, signup } = useAuth()
  const { submitRegistration, accessApiConfigured, approvalRequired } = useAccess()
  const location = useLocation()
  const navigate = useNavigate()
  const [formMode, setFormMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [organization, setOrganization] = useState('')
  const [accessNote, setAccessNote] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [err, setErr] = useState(null)
  const [pending, setPending] = useState(null)
  const [infoModal, setInfoModal] = useState(/** @type {LoginInfoModalKey | null} */ (null))

  const from = normalizeLoginRedirect(location.state?.from || DEFAULT_LOGIN_REDIRECT)

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
              Configure Firebase to use the app at{' '}
              <Link className="font-semibold text-primary hover:text-primary-dim" to="/dashboard">
                /dashboard
              </Link>
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
    return <PostLoginRedirect from={from} />
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
    if (!displayName.trim() || !organization.trim() || !accessNote.trim()) {
      setErr('Name, organization, and reason for access are required.')
      return
    }
    setErr(null)
    setPending('signup')
    try {
      await signup(email, password, rememberMe)
      if (accessApiConfigured && approvalRequired) {
        await submitRegistration({
          display_name: displayName.trim(),
          organization: organization.trim(),
          access_note: accessNote.trim(),
        })
        navigate('/pending-approval', { replace: true })
      } else {
        redirectAfterAuth(from)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  const isSignup = formMode === 'signup'
  const activeInfoModal = infoModal ? LOGIN_INFO_MODALS[infoModal] : null
  const InfoModalContent = activeInfoModal?.Content ?? null

  function openInfoModal(key) {
    setInfoModal(key)
  }

  function onForgotPasswordClick(e) {
    e.preventDefault()
    openInfoModal('forgot-password')
  }

  return (
    <div
      className="auth-bg flex min-h-[100dvh] justify-center overflow-y-auto bg-surface p-4 font-body text-on-surface sm:p-6"
      data-location="Milwaukee"
    >
      <main
        className={`my-auto w-full shrink-0 ${isSignup ? 'max-w-2xl' : 'max-w-md'}`}
      >
        {/* Central Login Card */}
        <div
          className={`glass-panel flex flex-col rounded-[1.5rem] border-none shadow-2xl ${
            isSignup ? 'gap-5 p-6 md:gap-6 md:p-8' : 'gap-8 p-8 md:p-10'
          }`}
        >

          {/* Branding Header */}
          <div
            className={`flex flex-col items-center text-center ${isSignup ? 'gap-2' : 'gap-4'}`}
          >
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
          <div className="space-y-3">
            <div className="flex rounded-xl bg-surface-container-high p-1">
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${formMode === 'login' ? 'bg-white text-indigo-700 shadow-sm' : 'text-on-surface-variant'}`}
                onClick={() => setFormMode('login')}
                disabled={busy}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${formMode === 'signup' ? 'bg-white text-indigo-700 shadow-sm' : 'text-on-surface-variant'}`}
                onClick={() => setFormMode('signup')}
                disabled={busy}
              >
                Request access
              </button>
            </div>
            <h2 className={`font-bold tracking-tight text-gray-800 ${isSignup ? 'text-xl' : 'text-2xl'}`}>
              {formMode === 'login' ? 'Sign In' : 'Request portal access'}
            </h2>
            <p
              className={`text-on-surface-variant leading-relaxed ${isSignup ? 'text-xs sm:text-sm' : 'text-sm'}`}
            >
              {formMode === 'login'
                ? 'Enter your municipal credentials to access the ledger.'
                : 'Create credentials and submit a request. An administrator must approve your account before you can use the portal.'}
            </p>
          </div>

          {/* Login Form */}
          <form className={`flex flex-col ${isSignup ? 'gap-4' : 'gap-5'}`} onSubmit={onSubmit}>
            <div className={isSignup ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4' : 'space-y-4'}>

              {/* Email Field */}
              <div className={`space-y-1.5 ${isSignup ? 'sm:col-span-1' : ''}`}>
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
                    className={`block w-full rounded-xl border-none bg-surface-container-high pl-11 pr-4 text-on-surface transition-all duration-200 placeholder:text-outline/60 focus:bg-white focus:ring-0 ${isSignup ? 'py-2.5' : 'py-3'}`}
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
              <div className={`space-y-1.5 ${isSignup ? 'sm:col-span-1' : ''}`}>
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
                    className={`block w-full rounded-xl border-none bg-surface-container-high pl-11 pr-4 text-on-surface transition-all duration-200 placeholder:text-outline/60 focus:bg-white focus:ring-0 ${isSignup ? 'py-2.5' : 'py-3'}`}
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

              {isSignup && (
                <>
                  <div className="space-y-1.5 sm:col-span-1">
                    <label className="ml-1 text-xs font-semibold text-on-surface-variant" htmlFor="displayName">
                      Full name
                    </label>
                    <input
                      className="block w-full rounded-xl border-none bg-surface-container-high px-4 py-2.5 text-on-surface"
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-1">
                    <label className="ml-1 text-xs font-semibold text-on-surface-variant" htmlFor="organization">
                      Organization / department
                    </label>
                    <input
                      className="block w-full rounded-xl border-none bg-surface-container-high px-4 py-2.5 text-on-surface"
                      id="organization"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="ml-1 text-xs font-semibold text-on-surface-variant" htmlFor="accessNote">
                      Reason for access
                    </label>
                    <textarea
                      className="block min-h-[4.5rem] w-full resize-y rounded-xl border-none bg-surface-container-high px-4 py-2.5 text-on-surface"
                      id="accessNote"
                      rows={2}
                      value={accessNote}
                      onChange={(e) => setAccessNote(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </div>
                </>
              )}
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
              <button
                type="button"
                className="text-xs font-bold text-primary hover:text-primary-dim transition-colors"
                onClick={onForgotPasswordClick}
                disabled={busy}
              >
                Forgot Password?
              </button>
            </div>

            {err && (
              <p className="text-center text-sm font-medium text-error" role="alert">
                {err}
              </p>
            )}

            {/* Actions */}
            <div className={`flex flex-col gap-3 ${isSignup ? 'mt-2' : 'mt-4'}`}>
              {formMode === 'login' ? (
                <button
                  className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dim px-6 py-4 font-bold text-on-primary shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                  type="submit"
                  disabled={busy}
                >
                  {pending === 'login' ? 'Signing in…' : 'Login to Portal'}
                </button>
              ) : (
                <button
                  className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dim px-6 py-3.5 font-bold text-on-primary shadow-lg shadow-primary/25 transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                  type="button"
                  disabled={busy}
                  onClick={onSignUp}
                >
                  {pending === 'signup' ? 'Submitting request…' : 'Submit access request'}
                </button>
              )}
            </div>
          </form>

          {/* Footer Section within Card */}
          <div
            className={`border-t border-outline-variant/10 text-center ${isSignup ? 'pt-4' : 'pt-8'}`}
          >
            <p className="px-2 text-[0.65rem] leading-relaxed text-on-surface-variant">
              By using this portal, you agree to our{' '}
              <button
                type="button"
                className="font-bold text-primary hover:text-primary-dim"
                onClick={() => openInfoModal('security')}
              >
                Security &amp; Terms
              </button>{' '}
              and{' '}
              <button
                type="button"
                className="font-bold text-primary hover:text-primary-dim"
                onClick={() => openInfoModal('privacy')}
              >
                Privacy Policy
              </button>
              .
            </p>
            <p className="mt-3 text-[0.65rem] font-medium text-outline uppercase tracking-widest">
              © 2026 Municipal Forestry Dept.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-4">
              <button
                type="button"
                className="text-[0.65rem] font-bold text-on-surface-variant transition-colors hover:text-primary"
                onClick={() => openInfoModal('privacy')}
              >
                Privacy
              </button>
              <button
                type="button"
                className="text-[0.65rem] font-bold text-on-surface-variant transition-colors hover:text-primary"
                onClick={() => openInfoModal('security')}
              >
                Security
              </button>
              <button
                type="button"
                className="text-[0.65rem] font-bold text-on-surface-variant transition-colors hover:text-primary"
                onClick={() => openInfoModal('help')}
              >
                Help
              </button>
            </div>
          </div>
        </div>
      </main>

      {activeInfoModal ? (
        <LoginInfoModal
          open
          title={activeInfoModal.title}
          onClose={() => setInfoModal(null)}
        >
          <InfoModalContent />
          {infoModal === 'privacy' || infoModal === 'security' ? (
            <p className="mt-4 border-t border-outline-variant/10 pt-3 text-[10px] text-outline">
              Last updated: {LOGIN_LEGAL_LAST_UPDATED}. This text is provided for informational purposes
              only and does not constitute legal advice.
            </p>
          ) : null}
        </LoginInfoModal>
      ) : null}

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