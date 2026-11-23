# Concept 01 (Incident Archive) — Performance Report

**Branch:** `frontend/concept-01-incident-archive`
**Measured:** 2026-11-23 on the production build (`npm run build`, vite 8, React 19).

## 1. Bundle budget (measured, gzip)

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (single initial chunk) | 374.4 KB | **104.05 KB** |
| `index-*.css` | 33.3 KB | **6.92 KB** |
| Fonts (@fontsource Fraunces/Archivo/IBM Plex Mono, latin, woff) | ~19-22 KB each | self-hosted |

No icon pack, no charting library, no animation library. Stamp/docket visuals are pure
CSS (perforated edges via radial-gradient, stamp borders via inset box-shadow).

## 2. Honest gaps

- **No route-level code splitting.** Admin/review code ships in the initial bundle;
  `React.lazy` per role is the recommended follow-up (estimate, not measured).
- No Lighthouse claim (not measured here).
- Polling cadences follow the contract (`/v1/state` 5 s, queue 8 s, submissions 15 s,
  leaderboard 20 s, results 30 s). Draft autosave debounces 3 s. Token refresh is a
  single-flight shared promise on 401 (`AUTH_TOKEN_EXPIRED`).

## 3. Rendering cost

- Animations: one `animate-pulse` beacon; reduced-motion honoured globally in `app.css`.
- Code viewer and tables render plain rows; fine for the platform's 512 KiB file cap,
  revisit virtualisation only for very large files.
