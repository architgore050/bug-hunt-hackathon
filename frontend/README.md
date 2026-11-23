# Bug Hunt CTF Frontend — Concept 03: The Failure Atlas

Art-directed alternative frontend for **Bug Hunt CTF (Fall Back)**, organised by the
Software Development Club at VIT Bhopal University.

**Design thesis:** a topological failure-mapping console. The codebase is charted as
geological strata; a vulnerability is a *shear line* with exact coordinates
(`COORD:routes/notes.js#L44-46`), and a repair is a *stabilization anchor*.

## Stack

Vite + React 19 + TypeScript + Tailwind CSS 4. Fonts: Fraunces (elevation callouts),
Archivo (sector taxonomy), IBM Plex Mono (coordinates). No icon pack, no charting
library, no animation library; all visuals are CSS/SVG primitives.

## Run

```bash
npm ci
npm run dev      # dev server on :5173, proxies /v1 and /health to 127.0.0.1:8100
npm run build    # type-check + production build
npm run lint     # oxlint
```

The backend contract lives in `docs/frontend/FRONTEND_INTEGRATION_CONTRACT.md`; the
shared client layer is `src/lib/api.ts` / `types.ts` / `time.ts` (identical across all
concept branches by design), while `src/lib/auth.tsx` carries this concept's session
gate art direction.

## Concept documents

- `docs/frontend/concepts/CONCEPT-03-failure-atlas.md` — art direction source
- `docs/frontend/FRONTEND_QA_AND_ACCESSIBILITY.md` — this concept's QA evidence
- `docs/frontend/FRONTEND_PERFORMANCE_REPORT.md` — bundle and loading observations
