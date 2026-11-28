# Audit dataset provenance

**Dataset:** `findings_all.json`  
**Prepared:** 2026-11-27  
**Audit baseline:** `f96eb5ca` (the short SHA recorded by the source snapshot directory)  
**Code review reference:** `427f268` (the main-branch revision referenced by the audit review)  
**Aggregate records:** 389  
**Canonical report count:** 227 findings in the narrative audit report

## What this file represents

`findings_all.json` is an aggregate, machine-readable set of observations from the audit workstreams. It is not a live scan of the current branch. The narrative audit is stored under `sha-f96eb5ca/`; the review of that audit is stored alongside it. The aggregate includes outputs from multiple workstreams and therefore is not numerically identical to the 227 findings summarized in the narrative report.

The records commonly contain `id`, `agent`, `area`, `severity`, `title`, `evidence`, `impact`, `fix`, `spec_ref` and `_src`. The source data is not perfectly schema-homogeneous: consumers must tolerate absent optional fields and should not assume every record contains `impact` or `spec_ref`.

## Evidence and citation limits

File paths and line ranges in the dataset are **baseline-relative**. They point into the audit snapshot, not necessarily the current repository tree. A path that still exists may have changed substantially; a line range may have moved or been deleted. Before treating any record as a current defect, re-open the cited file at the target commit and verify the claim against current callers, tests and product decisions.

One known superseded record is marked with `audit_status: "superseded"`:

- **F-PRP-01** described the absence of participant-facing four-level submission workflows. That observation predates the implementation of the levels/team/repository/upload frontend and API. It is retained for audit history, but must not be counted as a current finding.

Other records remain historical observations until revalidated; absence of an explicit superseded marker does not mean the issue is confirmed at HEAD.

## Sensitive-file references

The dataset must not expose paths or line locations for the restricted organizer answer key. Related records now refer generically to the organizer answer key, without publishing the restricted filename or its internal line numbers. The answer-key content itself is not included in this dataset.

## Revalidation rule

When the audit is refreshed, record the exact full baseline commit SHA, preparation date, code-review commit, method and tools used. Revalidate each finding against that commit, distinguish product decisions from defects, update or supersede stale records, and keep the narrative count separate from the aggregate record count.
