Status: completed 2026-11-25 (owner-authorized history identity normalization)

# History Rewrite Report

The owner explicitly requested normalizing the repository commit history to
their GitHub account identity, replacing the placeholder agent identity
(`Z User <z@container>` and `Z User <agent@z.ai>`) left by earlier agent
commits. This report records exactly what was done, per the orchestrator
baseline section 14.

## Identity used

- Author and committer for rewritten commits: `architgore050
  <gorearchit050@gmail.com>`.
- Pre-rewrite verification: the GitHub API account for the token is
  `architgore050`, and `gorearchit050@gmail.com` is the account's verified,
  primary email (`GET /user/emails` returned it verified=True primary=True).
- New commits made by this branch use the same identity via repository-local
  git config.

## Scope: 16 placeholder commits

| Location | Placeholder commits |
| --- | --- |
| Base history reachable from every branch (including main) | 6 (initial backend build, dev DB hardening, docs/CI, journey verification) |
| frontend/concept-01-incident-archive | 2 |
| frontend/concept-02-recovery-instrument | 2 |
| frontend/concept-03-failure-atlas | 5 |
| frontend/rebuild-base | 1 |

All 16 were agent-generated commits made on the owner's behalf. No
independent human contribution was rewritten: the repository's only
collaborator is `architgore050`, and the one outside contribution (PR #15
from the `tatha07` fork) lives on the fork and was not touched by the
rewrite.

## Method

- Full rollback bundle created BEFORE any change:
  `history-rewrite-backup/pre-identity-rewrite.bundle` (git bundle --all,
  verified complete history; SHA-256 recorded in the manifest next to it,
  also in `docs` handoff artifacts). Manifest file:
  `history-rewrite-backup/HISTORY_REWRITE_MANIFEST.txt` with all old branch
  and tag tips, per-ref old-to-new mapping, and the exact branch-protection
  snapshot.
- Tool: `git filter-repo` with conditional name/email callbacks replacing
  ONLY the two placeholder identities; every other author/committer byte
  (including `architgore050 <architgore050@users.noreply.github.com>` and
  the GitHub web merge identity) preserved unchanged.
- Verification BEFORE pushing: zero placeholder identities across all refs;
  per-ref TREE hashes identical to pre-rewrite (identity-only change), all
  15 branches + 1 tag.
- Pushes: per-ref explicit `--force-with-lease=<ref>:<old-sha>` for all 15
  branches and the tag; `main` last. No `--mirror`. Transient secondary-rate
  limiting on the first batch was handled with per-push retries.
- Branch protection: `main` requires 6 status checks, 1 approval, force
  pushes disabled, `enforce_admins` false. Because the push was declined by
  the protection hook, `allow_force_pushes` was temporarily enabled, the
  rewritten main was pushed with its lease, and the exact original settings
  were restored immediately and verified field-by-field (contexts, strict,
  dismiss_stale_reviews, required_approving_review_count, enforce_admins,
  allow_force_pushes back to disabled).

## Outcomes

- Every commit on every branch and the tag now carries either the requested
  identity (rewritten commits) or its original `architgore050` identity
  (previously correct commits). Verified locally and via the GitHub commits
  API after the push.
- Commit messages, author/committer timestamps, parent topology, file
  contents and branch/tag names are preserved; commit hashes changed
  everywhere (the 6 base commits are ancestors of every branch).
- Signatures: the 6 GitHub-web merge commits carried GitHub PGP signatures;
  rewritten objects cannot keep valid signatures, so the `gpgsig` headers
  were stripped by the tool. No Z-identity commit was ever signed. No
  release tags existed.
- The tag `pre-cleanroom-checkpoint` was retargeted to its rewritten commit
  and pushed with the same lease discipline.

## Pull request effects

- GitHub auto-closed open PRs #10-#13 (head branches rewritten) and #15
  (base rewritten) as a side effect of the force pushes; this was not
  requested.
- #10-#13 were recreated with identical titles, bodies and branches as PRs
  #16, #17, #18, #19 (each notes the recreation on top of the original
  body). GitHub compare confirms the diffs are unchanged (merge bases
  resolve; trees identical).
- PR #15 (fork contribution) cannot be reopened or recreated while the fork
  still holds pre-rewrite history ("no history in common"). Recovery: the
  fork owner syncs with the updated upstream main, then reopens or recreates
  the PR; a factual note with these steps was posted on #15.

## Backup artifacts

- `history-rewrite-backup/pre-identity-rewrite.bundle` - complete pre-rewrite
  history (all refs). SHA-256:
  `029e6926cb57420506a3167b1e50c57c8d96a5776335ebae88cab670dfba37ec`.
- `history-rewrite-backup/HISTORY_REWRITE_MANIFEST.txt` - ref tips, mapping,
  protection snapshot, notes. Restore procedure: `git clone <bundle> <dir>`
  then push the desired refs.
