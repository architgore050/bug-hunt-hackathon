# AGENTS.md review rubric

AGENTS.md is loaded at the start of agent tasks. Every line has a recurring cost in attention and tokens. The standard is short, specific, true, and safe.

## Inclusion test

Apply to every line:

1. Can the agent discover this from code, config, README, scripts, directory layout, or tooling? If yes, cut it or replace it with a pointer.
2. If not, does it materially affect task success, cost, integrity, or safety, and is a capable agent likely to get it wrong without it? If yes, keep it.
3. If unsure, cut it. Re-add it after an observed failure.

## What to keep

- Exact build, test, lint, typecheck, format, migration, and local-run commands.
- Non-obvious tooling and runtime requirements.
- Ordering constraints and generated-file ownership.
- Tests that need PostgreSQL, a running API, or a worker.
- Boundaries around secrets, restricted organizer material, ground truth, and production data.
- Actions requiring explicit approval, especially destructive commands, migrations, credential rotation, and branch deletion.
- Repository-specific conventions not already enforced by tooling.
- Definition of done and required verification gates.
- Pointers to deeper docs with a when-to-read hint.

## What to cut

| Content | Why |
|---|---|
| Directory tree dumps and obvious architecture prose | Discoverable and stale after moves |
| Generic advice such as "write clean code" | Does not change behavior |
| Rules already enforced by lint, format, types, or CI | Tooling gives direct feedback |
| Long style guides pasted inline | Link or enforce instead |
| Aspirational practices the repo does not follow | Actively misleading |
| Personal preferences | Belong in local instructions |
| Secrets, tokens, private URLs, or restricted answers | Security and integrity risk |
| Persona fluff | No task-specific value |
| Duplicated README content | Two sources of truth drift |
| One-off task instructions | Belong in the prompt or issue |

## Structure

- Use imperative, concrete language.
- Put exact commands in code blocks or tables.
- Group by task: setup and commands, testing, conventions, boundaries, gotchas, pointers.
- Put failure-prone and safety-critical rules first.
- Show a short example only when a subtle convention needs it.
- Prefer one line per rule.

## Scale and layout

- Aim for a lean root file. Treat roughly 300 lines as a ceiling that needs justification.
- Use nested AGENTS.md files for package-specific rules.
- Move long reference material into docs and link with when-to-read hints.
- Keep one canonical file. Other tool-specific instruction files should import or link it rather than copy it.
- Do not rewrite a large existing file merely to satisfy a size preference. Flag the cost and propose targeted pruning.

## Keeping it current

- Update it in the same PR as changes to commands, tooling, structure, conventions, or safety boundaries.
- Add the smallest rule after an observed repeated mistake.
- Remove rules that no longer change behavior.
- Verify documented commands, paths, and pointers periodically.
- Check consistency with README, CI, nested files, and runbooks.
- Never auto-generate a wholesale replacement from a template or model summary. Draft from real failure modes and prune.

## Scoring

Score each criterion 0 to 2, total 12.

| Criterion | 0 | 1 | 2 |
|---|---|---|---|
| Accuracy | Stale or broken items | Mostly right | Commands, paths, versions verified |
| Signal density | Generic or discoverable | Mixed | Nearly every line earns its place |
| Actionability | Vague | Partly concrete | Executable and specific |
| Boundaries and gotchas | Absent | Some | Clear for repository risks |
| Size and layout | Bloated or monolithic | Acceptable | Lean with on-demand depth |
| Consistency | Conflicts or duplication | Minor overlap | One source of truth |

Interpretation: 10 to 12 healthy; 7 to 9 needs pruning and verification; 6 or less likely hurts more than it helps.

## Common findings

- **major**: documented build or test command fails; instruction contradicts CI or README; file tells agents to commit secrets, bypass tests, expose ground truth, or perform unapproved destructive cleanup.
- **major**: code changed tooling, structure, conventions, or boundaries but AGENTS.md was not updated.
- **minor**: duplicated architecture summary, generic best-practice list, excessive length, or copied policy across files.
- **nit**: formatting and ordering.
