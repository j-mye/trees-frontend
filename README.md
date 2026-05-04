# Trees — Pruning Planner

Web app for Milwaukee tree inventory: **quarter-section priority map**, **analytics builder**, **data management** (`trees_core` CRUD), and **user tasks** (service requests). The UI is a React (Vite) SPA; read/write APIs are **Firebase Authentication** + **Google Cloud Functions** backed by **BigQuery**.

## Repository layout

| Path | Purpose |
|------|---------|
| `frontend/` | React 19 + Vite + Tailwind + MapLibre + Recharts SPA |
| `database/cloud_functions/` | Python 3.12 Firebase Gen2 HTTP functions (`main.py` and subpackages) |
| `database/` | Notebooks, design notes (`DATABASE_DESIGN.md`), local BigQuery tooling |
| `firebase.json` | Hosting (`frontend/dist`) + Functions source (`database/cloud_functions`) |

## Prerequisites

- **Node.js** 20+ (for Vite)
- **npm** (ships with Node)
- **Firebase CLI** (`npm install -g firebase-tools`) for deploy
- **Python 3.12** + venv if you run or test Cloud Functions locally
- Firebase project access (this repo defaults to **`mke-trees`** via `.firebaserc`)

## Local development (frontend)

From the **`frontend`** directory:

```bash
cd frontend
npm install
```

Create **`frontend/.env`** (not committed) with at least Firebase web config and Cloud Function base URLs. Names must be prefixed with `VITE_` so Vite exposes them to the client.

**Firebase (required for sign-in):**

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

**Cloud Functions (set URLs to your deployed region + project):**

| Variable | Used for |
|----------|----------|
| `VITE_CF_GET_QUARTER_SECTION_MAP_DATA_URL` | Map / Inventory quarter-section summaries (GeoJSON) |
| `VITE_CF_GET_TREES_BY_QS_URL` | Trees for one quarter section |
| `VITE_CF_GET_TREE_SHAP_EXPLANATION_URL` | Optional SHAP text for a tree |
| `VITE_CF_ANALYTICS_QUERY_URL` | Optional remote analytics (BigQuery) |
| `VITE_CF_ANALYTICS_SCHEMA_URL` | Optional analytics schema hint |
| `VITE_CF_USER_TASKS_API_URL` | User tasks + assignees API |
| `VITE_CF_TREES_DATA_API_URL` | Data management — `trees_core` CRUD (`treesDataApi`) |

Run the dev server:

```bash
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). Sign in with a Firebase user allowed by your project.

## Production build

```bash
cd frontend
npm run build
```

Output: **`frontend/dist/`**. Firebase Hosting is configured to serve that folder (see `firebase.json`).

## Deploy (Firebase Hosting + Cloud Functions)

From the **repository root** (where `firebase.json` lives):

1. Build the SPA: `cd frontend && npm run build && cd ..`
2. Deploy:
   - **Hosting + functions:** `firebase deploy --only hosting,functions`
   - **Hosting only:** `firebase deploy --only hosting`
   - **Functions only:** `firebase deploy --only functions`

Ensure you are logged in (`firebase login`) and the correct project is selected (`firebase use` or `.firebaserc`).

Functions read BigQuery and Firebase settings from **environment / secrets** configured for Gen2 (see `database/cloud_functions/.env.example` for variable names such as `BQ_PROJECT_ID`, `BQ_DATASET`, `BQ_LOCATION`).

## App routes (after login)

| Route | Page |
|-------|------|
| `/`, `/dashboard` | Inventory map + quarter-section tools |
| `/analytics` | Chart builder (remote BigQuery and/or client fallback) |
| `/data-management` | Tree record CRUD (requires `VITE_CF_TREES_DATA_API_URL`) |
| `/user-tasks` | Users + service requests (requires `VITE_CF_USER_TASKS_API_URL`) |
| `/login` | Sign-in |

Legacy paths `/map`, `/priority-map`, `/risk-heatmap` redirect to `/dashboard`.

## Further reading

- **`database/DATABASE_DESIGN.md`** — Schema, tables (`trees_core`, `quarter_sections`, etc.), and migration notes  
- **`ANALYTICS_WRITEUP.md`** — Analytics UI and `analytics_query` behavior  
- **`frontend/src/analytics/README.md`** — Analytics module file map  

## Scripts reference

| Command | Where | Description |
|---------|--------|-------------|
| `npm run dev` | `frontend/` | Vite dev server |
| `npm run build` | `frontend/` | Production bundle → `frontend/dist` |
| `npm run preview` | `frontend/` | Local preview of production build |
| `npm run lint` | `frontend/` | ESLint |
