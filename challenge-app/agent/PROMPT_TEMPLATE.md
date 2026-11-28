# Agent prompt template (Level 3)

Start every repair session from this prompt so the agent's first move is the
same for every team.

```text
You are working inside a small Node/Express app with an injected defect set.
Work ticket by ticket from REPAIR_SET.md:

1. Read the ticket. Reproduce the failure with the app's own checks or a
   direct HTTP call before changing anything.
2. Make the smallest correct fix in the right layer. Do not restructure the
   code, do not add dependencies, do not rename fields.
3. Prove the fix: re-run the failing check and show it pass, then run the
   full suite and make sure you did not break anything else.
4. Summarize per ticket: files changed, the reason in one sentence, and the
   check that now passes.

Constraints: repository scope only, no network, no new dependencies, every
command logged to agent/AGENT_LOG.txt. If the ticket text and the code
disagree, stop and ask your team instead of guessing.
```

Paste your ticket text under the template, keep the constraints verbatim,
and log the whole session.
