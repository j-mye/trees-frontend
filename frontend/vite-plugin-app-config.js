/**
 * Serves /app-config.js from VITE_* env vars so static pages (e.g. dashboard.html) share
 * the same Firebase + Cloud Function URLs as the React app. Emits dist/app-config.js on build.
 */
import fs from 'node:fs'
import path from 'node:path'

function buildConfigObject(env) {
  return {
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY || '',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
      projectId: env.VITE_FIREBASE_PROJECT_ID || '',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: env.VITE_FIREBASE_APP_ID || '',
    },
    cloudFunctions: {
      listQuarterSections: env.VITE_CF_LIST_QUARTER_SECTIONS_URL || '',
      getQsShapDetails: env.VITE_CF_GET_QS_SHAP_DETAILS_URL || '',
      getQuarterSectionSummaries: env.VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL || '',
      getTreesByQs: env.VITE_CF_GET_TREES_BY_QS_URL || '',
    },
  }
}

export function appConfigPlugin(env) {
  const body = `window.__APP_CONFIG__=${JSON.stringify(buildConfigObject(env))};`
  let outDir = 'dist'

  return {
    name: 'app-config',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir || 'dist')
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/app-config.js' || req.url?.startsWith('/app-config.js?')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
          return
        }
        next()
      })
    },
    writeBundle() {
      try {
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'app-config.js'), body, 'utf8')
      } catch {
        /* read-only fs in some CI */
      }
    },
  }
}
