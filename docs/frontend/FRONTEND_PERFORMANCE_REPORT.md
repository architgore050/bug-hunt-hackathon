# Concept 02 (Recovery Instrument) — Performance Report

**Branch:** `frontend/concept-02-recovery-instrument`
**Measured:** 2026-11-23 on the production build (`npm run build`, vite 8, React 19).

## 1. Bundle budget (measured, gzip)

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (single initial chunk) | 368.0 KB | **102.08 KB** |
| `index-*.css` | 27.4 KB | **5.92 KB** |
| Fonts (@fontsource Archivo/IBM Plex Mono, latin, woff) | ~19-22 KB each | self-hosted |

The leanest of the three alternatives. Instrument visuals ( AnnunciatorBar, DetentCounter,
racks, switch bezels) are pure CSS; no icon pack, no chart or animation library.

## 2. Honest gaps

- **No route-level code splitting.** Admin/review code ships in the initial bundle;
  `React.lazy` per role is the recommended follow-up (estimate, not measured).
- No Lighthouse claim (not measured here).
- Polling cadences follow the contract (`/v1/state` 5 s, queue 8 s, submissions 15 s,
  leaderboard 20 s, results 30 s). Draft autosave debounces 3 s. Token refresh is a
  single-flight shared promise on 401.

## 3. Rendering cost

- Animations: annunciator pulse only; reduced-motion honoured globally in `app.css`.
- Code viewer and tables render plain rows; revisit virtualisation only for very large
  files (upload cap is 512 KiB).
