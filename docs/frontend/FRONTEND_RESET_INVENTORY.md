# Frontend Reset Inventory & Clean-Room Audit

**Date:** 2026-11-23  
**Status:** Executed  
**Repository:** `https://github.com/architgore050/bug-hunt-hackathon`  
**Base Branch:** `frontend/rebuild-base`  
**Checkpoint Tag:** `pre-cleanroom-checkpoint` (pushed to remote)

---

## 1. Identified Frontend Application Root(s)

- Primary Frontend Application Root: `frontend/`
- Target Vulnerable CTF Application (Not a frontend root for the platform; preserved intact): `challenge-app/`
- Platform Backend: `backend/` (FastAPI; preserved intact)

---

## 2. Source-Code Paths Removed

In accordance with the clean-room protocol, no contents of the existing frontend implementation were read or preserved. The following files and directories under `frontend/src` were completely removed:

### Pages
- `frontend/src/pages/Landing.tsx`
- `frontend/src/pages/Activate.tsx`
- `frontend/src/pages/Rules.tsx`
- `frontend/src/pages/Privacy.tsx`
- `frontend/src/pages/Terms.tsx`
- `frontend/src/pages/Login.tsx`
- `frontend/src/pages/NotFound.tsx`
- `frontend/src/pages/participant/Lobby.tsx`
- `frontend/src/pages/participant/Workspace.tsx`
- `frontend/src/pages/participant/Submissions.tsx`
- `frontend/src/pages/participant/Account.tsx`
- `frontend/src/pages/participant/Results.tsx`
- `frontend/src/pages/participant/Leaderboard.tsx`
- `frontend/src/pages/participant/SubmissionDetail.tsx`
- `frontend/src/pages/review/Queue.tsx`
- `frontend/src/pages/review/ItemDetail.tsx`
- `frontend/src/pages/admin/Dashboard.tsx`
- `frontend/src/pages/admin/Challenges.tsx`

### Components & UI
- `frontend/src/components/DisputeForm.tsx`
- `frontend/src/components/StepUp.tsx`
- `frontend/src/components/chrome.tsx`
- `frontend/src/ui/icons.tsx`
- `frontend/src/ui/components.tsx`

### Styles & Design Tokens
- `frontend/src/styles/app.css`
- `frontend/src/styles/tokens.css`

### Application Wiring & Client Logic
- `frontend/src/App.tsx`
- `frontend/src/main.tsx`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/auth.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/format.ts`

### Entry Point
- `frontend/index.html` (purged; will be replaced with clean HTML shells for each concept)

---

## 3. Assets Reviewed & Disposition

- `frontend/public/favicon.svg` — Retained generic icon until replaced by art-directed concept assets.
- External brand assets: None present in repository root. Any wordmarks or identity marks will be created cleanly and art-directed.

---

## 4. Build, Dev, Test & Deployment Configuration Preserved

The underlying Vite and TypeScript build infrastructure was verified and preserved intact:
- `frontend/package.json` — Preserved (Vite, React 19, React Router 7, TanStack Query 5, Tailwind CSS v4, oxlint).
- `frontend/package-lock.json` — Preserved.
- `frontend/vite.config.ts` — Preserved (defines proxy for `/v1` and `/health` to `http://127.0.0.1:8100` on port 5173).
- `frontend/tsconfig.json` — Preserved.
- `frontend/tsconfig.app.json` — Preserved.
- `frontend/tsconfig.node.json` — Preserved.
- `frontend/.oxlintrc.json` — Preserved.
- `frontend/.gitignore` — Preserved.

Backend, test, database, and dev scripts preserved:
- `backend/` — All models, routers, migrations, tests, worker, configuration.
- `challenge-app/` — Preserved intact.
- `scripts/` — All database, migration, and run scripts preserved.
- `docs/` — All specifications and architecture docs preserved.

---

## 5. Files Deliberately Left Untouched (Ambiguity Review)

- `challenge-app/` contains its own Express server and minimal HTML/CSS in `challenge-app/public/`. This was confirmed to be the CTF target vulnerability repository and was left completely untouched.

---

## 6. Dependency & Package Review

- Preserved dependencies: React 19, React Router v7, `@tanstack/react-query` v5, `@tailwindcss/vite` v4, `tailwindcss` v4.
- Icons: The old `src/ui/icons.tsx` was removed. In strict compliance with the anti-pattern list, Lucide is prohibited. Clean SVG icons tailored to each concept will be used.
- Fonts: `@fontsource/archivo`, `@fontsource/fraunces`, and `@fontsource/ibm-plex-mono` are present in package.json and provide high-quality typography without relying on Inter, Geist, or Space Grotesk.
