# FMD-CLOUD-024-eval-live - orchestrator report (w13, eval-live)

PR: https://github.com/architgore050/findMyDreamCollege/pull/12
Branch `v1/eval-live` → `main`, base `1269b3b` (prompt base `ebef0f0` had moved; per the
branching protocol the true base for this run is the current tip). Work was done directly on the
branch rather than via sub-PRs (the protocol permits; subagents were not needed for the pieces).

## What was built

- **Backend** - `fmd/eval/verdict_live.py`: `LiveVerdictBackend` on the frozen `VerdictBackend`
  protocol. Bounded research loop through the provider-agnostic router (one action per turn:
  `fetch_url` / `cite_source` / `emit_verdict`), hard caps in code (8 turns / 6 fetches, CLI
  tunable), every fetch through `fmd/fetch` (robots.txt, per-domain rate limits, truthful UA; no
  auth/CAPTCHA bypass, no paid APIs). The model never scores or hashes: the turn schema is
  `extra="forbid"`, sha256 is computed harness-side over the bytes the fetch layer stored and
  re-verified per pointer (`reverify_evidence`); UNKNOWN is first-class and a capped/errored loop
  degrades to an honest `unknown` naming its stop reason; the circularity guard stays in
  `audit_verdict`, unchanged.
- **CLI** - `--stream verdict-live` (replay sessions when the `verdict_live` profile resolves to
  the mock provider; live `FetchLadder` on the operator's host), `--audit-sample/--audit-seed`
  (seeded 10–20 % clamped, all incorrect/partially_correct stratified in; worksheet carries the
  full evidence graph + fetch ledger + empty `operator_agreement`), `--audit-score` (agreement
  rate vs the ≥70 % gate → PASS/FAIL/INSUFFICIENT, exit 0/1/3; reported, never enforced in CI).
  `config/models.yaml` gained the sanctioned `verdict_live` profile (local Gemma default,
  env-switchable; required for purpose-keyed audit logging).
- **Replay fixtures + tests** - 8 committed scripted sessions under
  `tests/fixtures/eval_verdict/live/sessions/` and 27 offline tests in
  `test_eval_verdict_live.py` covering the full required matrix (caps, sha256 pass/tamper-fail,
  circularity, score-emission rejection + recovery, UNKNOWN never coerced, deterministic seeded
  sampling, audit-score PASS/FAIL/INSUFFICIENT, CLI end-to-end on mock + exit codes).
- **Docs** - doc 04 appended with an "Implemented" section (history untouched, exact commands);
  new `docs/v1/eval/07-verdict-live-runbook.md` (serve_local start/probe/stop, env
  `FMD_EXTRACT_PROVIDER=local`, `FMD_SNAPSHOT_DIR=$HOME/fmd-snap2`, the verdict-live command, the
  audit loop, the ≤100 MiB GPU-free rule, and the note that the live stream has NEVER run against
  a real model - the first real run is the operator's, LQ-9).

## Gates (tip `f75bc11`)

- `uv sync --all-extras` - exit 0
- `uv run ruff check .` - clean
- `uv run pytest -q` - run reported green; skips are the DB-backed tests
  (no postgres in this sandbox - the operator runs them at intake)
- `fmd eval --golden ../../data/golden` - provenance coverage **1.0**, gate PASS
- Dry-runs exit 0: nirf-proxy, naac-proxy, self-drift, cv-stability, verdict-fast, expert-panel,
  **verdict-live on the mock provider**
- verdict-live with no resolvable model fails honestly (exit 1)
- Committed replay artifacts: `reports/eval-verdict-live-mock-canary.json` and
  `reports/audit-verdict-live-mock-canary.json` (seed 13, fraction 0.15, empty operator fields)

Everything proven is the replay path; no live-model behavior is claimed anywhere.

## Top 3 honest gaps

1. **Prompt quality is unproven.** The system prompt and turn schema were never exercised by a
   real model; guided-JSON over the nested verdict object may degrade to JSON-instruct on
   llama.cpp, and repair loops will consume the 8-turn budget quickly.
2. **The caps will bite on real research.** 8 turns is tight (3 fetch + 3 cite + verdict); a 404
   or robots refusal leaves no budget to recover, so expect high `unknown_coverage` on the first
   live run.
3. **Worksheet must be sampled in-run** (`--audit-sample` reads that run's cases; regenerating
   from an existing report is not implemented), and fetched-page excerpts fed back into prompts
   are an unsanitized prompt-injection surface.
