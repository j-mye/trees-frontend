/**
 * Quarter Section cards + SHAP panel with Firebase Auth + Cloud Functions.
 * Requires /app-config.js (from Vite) for Firebase config and function HTTPS URLs.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js'
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js'

function cloudFunctions() {
  return window.__APP_CONFIG__?.cloudFunctions || {}
}

function resolveListUrl() {
  const direct = cloudFunctions().listQuarterSections
  if (direct) return direct
  return ''
}

function resolveShapUrl() {
  const direct = cloudFunctions().getQsShapDetails
  if (direct) return direct
  return ''
}

async function authFetch(url, options = {}) {
  const auth = getAuth()
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const token = await user.getIdToken()
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
    credentials: 'omit',
  })
}

function qsCardStripHtml() {
  return (
    '<div id="qs-card-strip" class="absolute left-8 top-24 z-[15] w-full max-w-xl pr-4 pointer-events-auto">' +
    '<div class="rounded-2xl bg-white/90 backdrop-blur border border-white/60 shadow-lg p-4">' +
    '<div id="qs-auth-banner" class="mb-3 hidden"></div>' +
    '<h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Quarter Sections</h3>' +
    '<div id="qs-card-list" class="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto"></div>' +
    '<p id="qs-card-message" class="mt-2 text-sm text-slate-500 hidden"></p>' +
    '</div></div>'
  )
}

const DEFAULT_PROFILE_AVATAR_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCO9tdXZ4ckadl6C3SPKq4PfnGMgda1aanu8hu5_2QZVOfZd6F7aJKKUERbx7wxAEZS3kaCa0jv9o4irXFP4qRphKys9gPTJIu_3LNQhhiIZwChlsC8FsOG_cy870tRyhMS9fq_Vgvu7HXFBwf7rq4djUaLnYLUi0b65NqYc9JQO7nuCr8DIe4o6jOeCgF9z99baFpoLGlGImAcSXfW6O7erKYkbrRgxCbgWkuERpG07T1__pZR2wPZLMR5KMnw7EjusuI-XiNZUN_p'

/**
 * Top nav profile dropdown: toggle, outside click, Firebase sign-out.
 * @param {import('https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js').Auth} auth
 */
function setupProfileMenu(auth) {
  const root = document.getElementById('dash-profile-root')
  const btn = document.getElementById('dash-profile-btn')
  const menu = document.getElementById('dash-profile-menu')
  const nameEl = document.getElementById('dash-profile-name')
  const emailEl = document.getElementById('dash-profile-email')
  const imgEl = document.getElementById('dash-profile-img')
  const signOutBtn = document.getElementById('dash-profile-signout')
  if (!root || !btn || !menu) return () => {}

  function closeMenu() {
    menu.classList.add('hidden')
    btn.setAttribute('aria-expanded', 'false')
  }
  function openMenu() {
    menu.classList.remove('hidden')
    btn.setAttribute('aria-expanded', 'true')
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (menu.classList.contains('hidden')) openMenu()
    else closeMenu()
  })

  document.addEventListener('mousedown', (e) => {
    if (!root.contains(/** @type {Node} */ (e.target))) closeMenu()
  })

  root.querySelectorAll('[data-dash-profile-dismiss]').forEach((el) => {
    el.addEventListener('click', () => closeMenu())
  })

  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      closeMenu()
      try {
        await signOut(auth)
      } catch (_) {}
      window.location.href = '/login'
    })
  }

  return function syncProfileFromUser(user) {
    if (!user) return
    if (nameEl) nameEl.textContent = user.displayName?.trim() || 'City Arborist'
    if (emailEl) emailEl.textContent = user.email || 'arborist@municipal.gov'
    if (imgEl) {
      imgEl.src = user.photoURL || DEFAULT_PROFILE_AVATAR_URL
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderShapPanel(panel, qsId, payload, skeletonInner) {
  let shap = payload && payload.shap
  if (!Array.isArray(shap)) shap = []

  const rows = shap
    .map((row) => {
      const name = row.feature != null ? String(row.feature) : String(row.name || '')
      const val = row.value != null ? Number(row.value) : NaN
      const valStr = Number.isFinite(val) ? val.toFixed(4) : '—'
      return (
        '<tr class="border-b border-slate-100 last:border-0">' +
        '<td class="py-2 pr-3 text-sm text-slate-700">' +
        escapeHtml(name) +
        '</td>' +
        '<td class="py-2 text-sm font-mono text-right text-primary">' +
        valStr +
        '</td></tr>'
      )
    })
    .join('')

  panel.innerHTML =
    '<div class="shap-content-region flex flex-col h-full min-h-0">' +
    '<div class="mb-6">' +
    '<h2 class="text-xl font-bold text-slate-900">SHAP Reasoning</h2>' +
    '<p class="text-sm text-on-surface-variant mt-1">Quarter Section <span class="font-mono text-primary">' +
    escapeHtml(qsId) +
    '</span></p>' +
    '</div>' +
    '<div class="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-surface-container-low/50">' +
    '<table class="w-full text-left border-collapse">' +
    '<thead><tr class="text-xs uppercase text-slate-500 border-b border-slate-200">' +
    '<th class="py-2 pl-3">Feature</th><th class="py-2 pr-3 text-right">Contribution</th></tr></thead>' +
    '<tbody>' +
    (rows ||
      '<tr><td colspan="2" class="p-4 text-sm text-slate-500">No SHAP rows stored for this quarter section.</td></tr>') +
    '</tbody></table></div>' +
    '<button type="button" id="shap-back-skeleton" class="mt-6 w-full py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">' +
    'Show placeholder panel' +
    '</button></div>'

  const back = document.getElementById('shap-back-skeleton')
  if (back) {
    back.addEventListener('click', () => {
      panel.innerHTML = skeletonInner
    })
  }
}

function setPanelLoading(panel, loading) {
  if (loading) {
    panel.setAttribute('aria-busy', 'true')
    panel.classList.add('opacity-60')
    panel.style.pointerEvents = 'none'
    panel.innerHTML =
      '<div class="flex flex-col items-center justify-center gap-4 py-16 px-4">' +
      '<div class="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>' +
      '<p class="text-sm font-semibold text-slate-700">Loading SHAP values…</p></div>'
  } else {
    panel.removeAttribute('aria-busy')
    panel.classList.remove('opacity-60')
    panel.style.pointerEvents = ''
  }
}

function setSyncBanner(text) {
  const banner = document.querySelector('main .absolute.bottom-12')
  if (!banner) return
  const label = banner.querySelector('span')
  if (label) label.textContent = text || 'Syncing Forestry Ledger...'
}

function runDataUi(mainEl, panel, skeletonInner) {
  const listUrl = resolveListUrl()
  const shapUrl = resolveShapUrl()
  const listEl = document.getElementById('qs-card-list')
  const msgEl = document.getElementById('qs-card-message')

  function showMsg(text) {
    if (!msgEl) return
    msgEl.textContent = text
    msgEl.classList.remove('hidden')
  }

  if (!listUrl || !shapUrl) {
    showMsg(
      'Missing Cloud Function URLs. Set VITE_CF_* in .env and ensure /app-config.js is generated (vite dev / vite build).'
    )
    return
  }

  authFetch(listUrl, { method: 'GET' })
    .then((r) => {
      if (!r.ok) throw new Error('List failed: ' + r.status)
      return r.json()
    })
    .then((data) => {
      const items = (data && data.items) || []
      if (!listEl) return
      listEl.innerHTML = ''
      items.forEach((item) => {
        const id = item.id != null ? String(item.id) : ''
        if (!id) return
        const label = item.label != null ? String(item.label) : id
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.setAttribute('data-qs-id', id)
        btn.className =
          'qs-card px-3 py-2 rounded-xl text-sm font-medium bg-surface-container-low text-slate-800 border border-slate-200 hover:border-primary hover:bg-primary-container/30 transition-colors'
        btn.textContent = label
        btn.addEventListener('click', () => {
          document.querySelectorAll('.qs-card').forEach((el) => {
            el.classList.remove('ring-2', 'ring-primary', 'bg-indigo-50')
          })
          btn.classList.add('ring-2', 'ring-primary', 'bg-indigo-50')

          setSyncBanner('Loading SHAP for ' + id + '…')
          setPanelLoading(panel, true)

          const url =
            shapUrl + (shapUrl.includes('?') ? '&' : '?') + 'qsId=' + encodeURIComponent(id)
          authFetch(url, { method: 'GET' })
            .then((r) => {
              if (!r.ok) throw new Error('SHAP request failed: ' + r.status)
              return r.json()
            })
            .then((payload) => {
              setPanelLoading(panel, false)
              setSyncBanner('Syncing Forestry Ledger...')
              renderShapPanel(panel, id, payload, skeletonInner)
            })
            .catch((err) => {
              panel.removeAttribute('aria-busy')
              panel.classList.remove('opacity-60')
              panel.style.pointerEvents = ''
              setSyncBanner('Syncing Forestry Ledger...')
              panel.innerHTML =
                '<div class="p-4 text-sm text-red-700">' + escapeHtml(err.message || String(err)) + '</div>'
            })
        })
        listEl.appendChild(btn)
      })
      if (items.length === 0) showMsg('No quarter sections found in Firestore.')
    })
    .catch((err) => {
      showMsg(err.message || String(err))
    })
}

function main() {
  const cfg = window.__APP_CONFIG__
  if (!cfg?.firebase?.apiKey) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div style="padding:1rem;background:#fee;color:#900;font-family:sans-serif">Missing Firebase config. Use Vite (npm run dev / npm run build) so /app-config.js is served, and set VITE_FIREBASE_* in .env.</div>'
    )
    return
  }

  const app = initializeApp(cfg.firebase)
  const auth = getAuth(app)
  const syncProfileFromUser = setupProfileMenu(auth)

  const mainEl = document.querySelector('main')
  if (!mainEl) return
  const panel = mainEl.querySelector('.glass-panel')
  if (!panel) return
  const skeletonInner = panel.innerHTML

  mainEl.insertAdjacentHTML('afterbegin', qsCardStripHtml())

  const authBanner = document.getElementById('qs-auth-banner')
  let dataLoaded = false

  onAuthStateChanged(auth, (user) => {
    if (!authBanner) return
    if (!user) {
      dataLoaded = false
      authBanner.classList.remove('hidden')
      authBanner.innerHTML =
        '<p class="text-sm text-slate-700 mb-2">Sign in to load quarter sections and SHAP data.</p>' +
        '<button type="button" id="dash-google-signin" class="w-full py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold">Sign in with Google</button>' +
        '<p class="text-xs text-slate-500 mt-2"><a class="text-indigo-600 underline" href="/login">Open login page</a></p>'
      const btn = document.getElementById('dash-google-signin')
      if (btn) {
        btn.onclick = () => {
          signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {})
        }
      }
      return
    }
    syncProfileFromUser(user)
    authBanner.classList.add('hidden')
    if (!dataLoaded) {
      dataLoaded = true
      runDataUi(mainEl, panel, skeletonInner)
    }
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  main()
}
