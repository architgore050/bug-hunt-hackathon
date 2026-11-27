# Security review for LLM, agent, tool, skill, and MCP code

Read this when a change calls a model, builds prompts, gives a model tools, executes generated code, installs a skill or plugin, or integrates an MCP server. These systems add a failure class classic checklists miss: the model can be instructed by data.

## The core question: lethal trifecta

An agent is dangerous when one context combines:

1. Access to private data such as files, database rows, secrets, or other users' content.
2. Exposure to untrusted content such as web pages, issues, documents, uploads, tool results, or other agents' output.
3. A way to act externally through HTTP, messages, file writes, commands, commits, or deployments.

If a change creates or widens that combination, it is **major**, and **blocker** when real user data has no mitigation. Mitigation removes a leg: restrict egress, remove private-data access, or isolate untrusted content from tools. Prompt warnings alone are not a control.

## Checklist

### Prompt injection and data/instruction mixing

- Untrusted text is delimited and labeled, not concatenated as authority.
- Retrieved docs, issue text, filenames, commit messages, tool results, and file contents are treated as possible injection.
- Model authority over tools does not depend on what untrusted text says.
- Markdown or HTML from model output is sanitized and cannot exfiltrate through links or images.
- System prompts and secrets are not exposed to participants or logs.

### Excessive agency and tool permissions

- Each tool has the narrowest useful scope.
- Destructive actions such as delete, force-push, deploy, grant, or send require confirmation or are impossible by construction.
- Commands, paths, hosts, and repositories use allow-lists.
- Subagents do not inherit more privilege than their task needs.
- Credentials are scoped per task rather than ambient where practical.
- Branch deletion, worktree removal, database reset, and broad cleanup require explicit user approval for the exact targets.

### Output handling

- Model output is untrusted input to SQL, shell, file paths, HTML, and APIs.
- Structured output parsing is strict and fails closed.
- Generated code runs only in a sandbox with no host secrets, bounded network, ephemeral filesystem, and resource limits.
- A failed parse cannot grant permission or change a score.

### Secrets and data exposure

- No API key, token, connection string, or secret-bearing prompt appears in client code, logs, traces, analytics, or skill files.
- User data sent to a provider has a documented purpose, minimization, retention, and access policy.
- Shared caches, memory, vector stores, and conversation state are isolated by tenant or team.
- Restricted organizer material is never copied into prompts, reports, or participant-visible artifacts without explicit authorization.

### MCP servers, plugins, and skills

- Source is trusted, pinned, and reviewed like a dependency with execution rights.
- Tool descriptions and results are treated as untrusted text.
- Auto-approval is not broader than the task requires.
- Remote servers use authenticated, encrypted transport and disclose what data each call sends.
- A skill cannot silently escalate permissions, read secrets, run destructive scripts, or modify policy.
- Imported skills are scanned for prompt injection, unsafe commands, secret paths, and contradictions with repository rules.

### Abuse and cost

- Rate limits, per-user quotas, maximum tokens, steps, tool calls, and timeouts bound loops.
- Retries and agent loops have deduplication and loop detection.
- A hostile user cannot run up cost or hang a worker.
- Background agents cannot modify the same files or refs as the main task without coordination.

### Observability and testing

- Tool calls, approvals, and destructive actions are logged without secrets.
- Adversarial tests cover injected instructions, sandbox escape, tool misuse, and cross-user leakage.
- Permission-denied cases fail closed.
- Reviews distinguish confirmed behavior from model confidence.

## Typical findings

| Finding | Level |
|---|---|
| Agent with shell or network plus private-data access reads untrusted content | blocker or major |
| Model output interpolated into SQL, shell, raw HTML, or file path | blocker |
| Account-wide token used for a narrow repository task | major |
| No confirmation on a destructive tool action | major |
| No step, time, or cost cap on an agent loop | minor to major |
| Untrusted prompt text unlabeled but tools are properly constrained | minor |
| Imported skill instructs secret access, policy bypass, or broad deletion | blocker |

Check current OWASP guidance when citing external frameworks. Do not treat this checklist as proof that an agent system is secure.
