# Agent rules (Level 3 workspace)

You may use a coding agent for repair work in this level. The agent operates
under the rules below; breaking any of them is a competition violation.

1. Scope: the agent works only inside this repository folder. No network
   access, no plugin installs, no dependencies beyond what `package.json`
   already lists.
2. Scope of knowledge: the agent must never be pointed at platform storage,
   other teams' work, or anything outside this workspace.
3. Logging: every agent command and its output stays in the workspace log
   (`agent/AGENT_LOG.txt`). Organizers may ask to see it.
4. Human verification: the agent's output is a draft. A human on the team
   reviews every change before it is accepted; you own your submission.
5. Reproduce first: a fix is only accepted together with the failing check
   it turns green. A change with no reproduction is not a repair.
6. No new defects: after each accepted change, `npm test` must have no fewer
   failures than before the change, and the fixed flow must work end to end.

The rules amendment that allows agent use in Level 3 (Levels 1 and 2 stay
no-AI) is an organizer decision; see the event brief for the current state.
