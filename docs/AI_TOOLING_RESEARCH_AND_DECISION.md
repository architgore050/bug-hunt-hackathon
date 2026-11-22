# AI Tooling Research and Decision

- Project: Bug Hunt CTF platform (Fall Back event, Software Development Club, VIT Bhopal University)
- Date of research: 2026-11-22
- Status: Adopted decision record (R1, R2) plus standing gate (R5)
- Related records: DEC-13 as referenced in `backend/app/config.py` (line 48, `ai_assessment_enabled: bool = False`, comment: "DEC-13 / master prompt: off until an approved provider is verified") and `backend/app/matching.py` (line 15, "ai_assessment - optional, disabled by default (DEC-13)"). ADR-013 is the equivalent numbering used in coordination docs.
- Scope: (R1) which AI coding tools the SDC build team uses day-to-day, and (R2) the standing policy for participant AI use during the event. This document also defines the provider evaluation gate that must pass before AI-assisted report scoring is ever enabled.
- Context constraints: student-club run, zero budget, single-VM deployment (profile D0/D1), FastAPI + PostgreSQL backend, React frontend, small team with limited time.

## 1. Decision summary

| Decision | Verdict |
| --- | --- |
| R1 primary build tool | Gemini CLI, authenticated with personal Google accounts (free tier: 1,000 model requests per user per day) |
| R1 backup build tool | GitHub Copilot Free or Copilot Student via GitHub Education (IDE-native completions and chat); Google Antigravity as a second fallback for agentic work |
| R1 ruled out | Claude Code (no free tier), Codex CLI as primary (no verified free ChatGPT-plan sign-in path), Qwen Code free OAuth tier (no longer confirmed free in official docs) |
| R2 participant policy | AI tools remain prohibited for the main scored task; no AI-assisted submissions; enforced by venue LAN isolation, process supervision, and an honor clause in the rules; any change requires an explicit organizer decision, a rules version bump, and a config freeze |

Reasoning: every candidate with a genuinely free, capacious tier that fits a CLI-only, zero-budget workflow converges on Gemini CLI, whose personal-account quota (1,000 requests per day per user) exceeds what a handful of student developers can exhaust in an evening of work, and whose harness is Apache 2.0 licensed. GitHub Copilot is the natural backup because the team is composed of students who can individually verify for GitHub Education, and it covers the IDE side that a terminal agent does not. Both tools, on their free paths, send prompts and code to the vendor, so R1 is adopted strictly together with the data-safety rules in Section 3. For participants, the platform already treats human review as the only authoritative judge of reports (DEC-13 keeps AI scoring off), so allowing participant AI during the main task would undermine the exact skill the event measures; the prohibition stays until organizers deliberately change it.

## 2. Survey of candidates

Research method: web search performed on 2026-11-22 with the z-ai web search tool (8 queries), followed by direct page reads with the WebFetch tool for the claims marked "verified" below. Anything that could not be confirmed on a page I actually opened is marked unverified. No quota, price, or date in this section comes from anywhere other than the listed sources or is explicitly flagged as unverified.

Snapshot of the verified picture (details and caveats in each subsection):

| Candidate | Free path verified | Verified limit | Key data caveat | Verdict for us |
| --- | --- | --- | --- | --- |
| Gemini CLI | Yes, primary source | 1,000 model requests per user per day with personal Google account | Unpaid API path allows product-improvement use and human review; account-login path terms differ and were not fully verified | Adopt as primary |
| GitHub Copilot Free / Student | Yes, primary source | 2,000 completions per month (Free); unlimited completions plus 200 monthly AI credits (Student, from June 1, 2026) | Free/Pro/Pro+ interaction data used for training from April 24, 2026 unless opted out; Student exempt | Adopt as backup |
| Google Antigravity | Yes, primary source | Weekly-refreshed "meaningful quota", no published number; unlimited tab completions | Terms follow the underlying Google AI plan; same free-path caveats | Second fallback |
| OpenAI Codex CLI | Not verified | None found for a free plan; sign-in list names paid ChatGPT plans only | Account-level data controls seen in snippets only, unverified | Ruled out as primary |
| Claude Code | No free path | Not applicable; Pro/Max/Ultra/Team/Enterprise or Console required | Data sent to Anthropic servers under account terms | Ruled out |
| Qwen Code CLI | Not verified anymore | OAuth now requires an active Plus or Pro subscription in official docs | Formerly free 2,000/day tier only confirmed in community posts | Ruled out |
| OpenCode / Kimi / DeepSeek agents | No | Not verified from any primary page | Unknown | Out of scope this cycle |

### 2.1 OpenAI Codex CLI

- What it is: a terminal coding agent from OpenAI that runs locally; the repository is open source under the Apache-2.0 license (verified: https://github.com/openai/codex, opened 2026-11-22).
- Free-tier reality: the README sign-in path ("Sign in with ChatGPT") is described as part of a Plus, Pro, Business, Edu, or Enterprise plan; the free ChatGPT plan is not named in that list (verified: https://github.com/openai/codex, opened 2026-11-22). A community OpenAI forum thread documents the 5-hour window / weekly-cap limit system with user-measured estimates (for example, roughly 40 minutes of reasoning time per 5-hour window on one model for Plus), but the thread explicitly says its numbers are approximations and contains no free-plan figures at all (verified: https://community.openai.com/t/understanding-the-new-codex-limit-system-after-the-april-9-update/1378768, opened 2026-11-22). Third-party search results claim Codex "has no standalone free tier as of October 2026"; the article could not be opened, so that claim is unverified.
- License and privacy: the CLI code is Apache-2.0 (verified above); prompts and code are processed by OpenAI servers when using ChatGPT sign-in or an API key. OpenAI's exact data-control posture for Codex content was seen only in a search snippet stating that the ChatGPT account-level data controls apply; unverified.
- CLI/IDE fit: strong terminal fit, locally installed harness. The blocking issue for a zero-budget team is the unverified free path.

### 2.2 Gemini CLI

- What it is: Google's open-source terminal agent; "Gemini CLI software is licensed under the Apache 2.0 license" (verified: https://geminicli.com/docs/resources/tos-privacy, opened 2026-11-22).
- Free-tier reality: logging in with a personal Google account (Gemini Code Assist for individuals) gives 1,000 model requests per user per day; logging in with an unpaid Gemini API key gives 250 model requests per user per day, Flash model only; Vertex AI Express Mode allows 90 days before billing is required (verified: https://geminicli.com/docs/resources/quota-and-pricing, opened 2026-11-22). Third-party reporting agrees on the 1,000/day and 60 requests-per-minute figures (for example https://sessionwatcher.com/guides/gemini-cli-usage-limits, dated 2026-11-07, and https://docs.cloud.google.com/gemini/docs/quotas, dated 2026-11-10, both seen in search results but not opened: unverified as direct citations).
- License and privacy: the harness is Apache 2.0, and terms differ by authentication path; the terms page routes unpaid versus paid Gemini API users to different terms but does not itself restate the data rules (verified: https://geminicli.com/docs/resources/tos-privacy, opened 2026-11-22). For the unpaid Gemini API path, Google's terms state that content submitted "to provide, improve, and develop" products and machine-learning technologies may be used, that "human reviewers may read, annotate, and process your API input and output", and warn "Do not submit sensitive, confidential, or personal information to the Unpaid Services"; paid services do not use prompts or responses to improve products, and EEA/Switzerland/UK users get the paid treatment even on free services (verified: https://aistudio.google.com/docs/terms, opened 2026-11-22). For the personal Google account path specifically, a search snippet indicates inputs are treated as confidential under Code Assist terms; the Code Assist privacy notice itself could not be opened, so that statement is unverified.
- CLI/IDE fit: terminal-native agent with a large enough free quota for a small team; fits this project directly.

### 2.3 Google Antigravity

- What it is: Google's agentic IDE/agent surface tied to Google AI plans; includes a CLI and scheduled tasks, with Gemini models as the core agent model (verified: https://antigravity.google/docs/plans, opened 2026-11-22).
- Free-tier reality: accounts without a paid Google AI Pro/Ultra plan get baseline access described as "A meaningful quota, refreshed weekly" with a weekly rate limit, unlimited tab completions, and access to all product features including the CLI; no numeric free quota is published on that page (verified: https://antigravity.google/docs/plans, opened 2026-11-22). Third-party reporting describes the free tier as zero cost with paid quota riding on Google AI plans; seen in search results only (unverified as direct citation). Bring-your-own-key is not supported (verified above).
- License and privacy: data terms follow the Google AI plan in use; the same free-path caveat as Gemini applies, and specifics were not verified beyond the terms routing described in 2.2.
- CLI/IDE fit: good agentic IDE fit, but the weekly-quota cadence is worse than Gemini CLI's daily 1,000 for predictable evening work sessions, so it is a fallback rather than the primary.

### 2.4 GitHub Copilot (Free and Student)

- What it is: GitHub's IDE/CLI assistant; all plans include Copilot CLI and the Copilot app (verified: https://docs.github.com/en/copilot/get-started/plans, opened 2026-11-22).
- Free-tier reality: Copilot Free is "Limited to 2000 completions per month" with an allowance of GitHub AI Credits whose size is not published on that page (verified: https://docs.github.com/en/copilot/get-started/plans, opened 2026-11-22; exact credit number unverified). Copilot Student is free for verified students; from June 1, 2026 the Student plan receives 200 monthly included AI Credits while keeping unlimited code completions; from June 24, 2026 both Free and Student use auto model selection only (verified: https://github.com/orgs/community/discussions/189268, opened 2026-11-22). The Student plan was introduced on March 12, 2026, replacing prior complimentary access, with GitHub stating that free access for verified students is not changing (verified: same discussion page).
- License and privacy: GitHub announced that Copilot Free, Pro, and Pro+ interaction data (prompts, code snippets sent during sessions, accepted outputs, context) is used for AI model training starting April 24, 2026 unless the user opts out in Copilot account settings; Copilot Student users and free teacher access are explicitly not affected (verified: https://github.com/orgs/community/discussions/188488, opened 2026-11-22). GitHub and Microsoft personnel working on AI model development may access collected interaction data.
- CLI/IDE fit: excellent IDE fit and a real CLI; the student plan makes it the best zero-cost IDE companion for a university club.

### 2.5 Anthropic Claude Code

- What it is: Anthropic's coding agent for terminal, IDE, desktop, web, and Slack (verified: https://claude.com/product/claude-code, opened 2026-11-22 after a redirect from anthropic.com/claude-code).
- Free-tier reality: "You can access Claude Code with a Claude Pro, Max, or Ultra plan, a Team or Enterprise plan, or a Claude Console account"; the page lists no free tier, and Console usage is metered per token at standard API pricing (verified: https://claude.com/product/claude-code, opened 2026-11-22). A pricing-article snippet claiming "no reliable, always-on free Claude Code CLI plan" (https://www.jetadmin.io/blog/claude-code-pricing-plans-api-rates-and-total-cost-in-2026) could not be opened (HTTP 502); unverified as a citation, but it agrees with the official page.
- License and privacy: the client is not open source per available sources; unverified. Code and prompts are sent to Anthropic servers under the account terms.
- CLI/IDE fit: strong terminal agent, but with no free access path it is unusable by a zero-budget club; ruled out.

### 2.6 Qwen Code CLI and other open harnesses

- What it is: an open-source terminal coding agent from Alibaba, described as supporting OpenAI, Anthropic, Gemini, and Qwen-compatible endpoints (verified: https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth, opened 2026-11-22).
- Free-tier reality: widely reported in mid-2025 to 2026 community posts as a free OAuth tier of 2,000 requests per day and 60 per minute (seen in search snippets, for example a r/LocalLLaMA thread; unverified). However, the official authentication docs as of 2026-11-09 tie Qwen OAuth to an "active Plus or Pro subscription", and the words "free" and any 2,000-per-day mention do not appear on that page at all (verified: https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth, opened 2026-11-22). Conclusion: the formerly free OAuth tier is no longer confirmed free; treat Qwen Code as bring-your-own-key.
- Others: OpenCode (https://opencode.ai) advertises an open-source agent that connects to 200+ providers; seen in search results only, not opened, so unverified. Kimi CLI / Kimi Code and DeepSeek-based agents appeared only in third-party comparisons with no primary pages opened; all Kimi/DeepSeek free-tier claims in this document are unverified and no numbers are recorded for them.

## 3. Decision R1: build-team AI tooling

R1.1 The SDC build team adopts Gemini CLI as the primary AI coding tool for this project, authenticated with personal Google accounts on the free tier (1,000 model requests per user per day; verified in Section 2.2). Rationale: it is the only candidate where the free tier is (a) confirmed on a primary source I opened on 2026-11-22, (b) large enough for real evening-scale development by a handful of students, and (c) paired with an Apache 2.0 harness that runs in the terminal where our FastAPI and React work already lives. The free API-key path (250/day, Flash only) is not used.

R1.2 Backup: GitHub Copilot, via Copilot Student for verified students (unlimited completions plus 200 monthly AI Credits) or Copilot Free (2,000 completions per month) where verification is pending. It covers inline IDE completion and chat inside VS Code and the React frontend work, complementing the terminal agent. Second fallback for long agentic runs: Google Antigravity on its weekly-quota baseline. Claude Code, Codex CLI, and paid plans of any vendor are not adopted because the budget is zero and no free path was verified for them.

R1.3 Data-safety rules for build-team use (mandatory, because every adopted free path sends prompts and code to vendor servers):

- No secrets in prompts: no database passwords, JWT signing keys, `.env` contents, tokens, or credentials may ever be pasted into any AI tool. Secrets stay in the VM's environment files only.
- No participant data in cloud tools: no real participant names, emails, submissions, reports, or score data may be included in prompts. Synthetic or schema-only examples are allowed. This is non-negotiable because Gemini's unpaid-service terms permit human review of submitted content, and Copilot's Free/Pro training terms apply to individual users unless opted out.
- Opt out where possible: each Copilot user enables the model-training opt-out in Copilot account settings (available per the GitHub FAQ verified in Section 2.4); Student-plan users are exempt from training use anyway. Gemini CLI usage-statistics telemetry is disabled via its documented opt-out.
- Run agents on copies: agentic tools work on working trees; nothing agentic commits directly to `main` or runs against the production VM database. A human reviews and merges.
- Tool output is never trusted blind: any AI-suggested code follows the same review, lint, and test path as human code before it lands.

R1.4 Follow-up tasks:

1. Each build-team member installs Gemini CLI and completes Google sign-in; confirm the 1,000/day quota is active before the next working session.
2. Members with a GitHub account apply for GitHub Education verification to unlock Copilot Student; until verified, use Copilot Free with the training opt-out enabled.
3. Write the team data-safety rules above into the contributor onboarding note at the next docs pass (owner: build lead).
4. Re-check quota pages quarterly, since every vendor changed limits during 2026 (recorded changes this year: Codex limit-system update in April, Copilot usage-based billing on June 1, Copilot Student credit changes in June, Antigravity weekly rate limits). If Gemini's free quota shrinks below what the team needs, revisit this record.
5. Keep each member's tool config in their home directory only; no AI tool config, session logs, or prompt history files may be committed to the repository. Add these paths to `.gitignore` if any tool writes inside the project tree.
6. Review this record at the first post-event retro: if R2 ever moves (participant AI allowed on some track), re-run the vendor survey, because 2026 showed that quotas and privacy postures of these tools can change within a single semester.

## 4. Decision R2: participant AI policy for the event

R2.1 Platform stance reflected: the platform keeps AI-assisted report scoring off by default (`ai_assessment_enabled = False`, `backend/app/config.py` line 48, per DEC-13) until an approved provider is verified, and human review is the only authoritative judge of reports. The event policy must be consistent with that stance: the platform does not outsource judgment to AI, and neither should participants for the scored work.

R2.2 Policy verdict: AI tools remain prohibited for the main scored task. Participants may not use AI coding assistants, AI chatbots, or any LLM-based tool to produce, debug, or polish code, reports, or submissions during the competition window. Human-written code and human-written reports are the object being measured. This keeps the existing proposal default: no AI tools for the main task.

R2.3 What is allowed: standard non-AI tooling only (IDEs, documentation sites, official language/framework docs, Stack Overflow style references). Searching the web is allowed; asking an AI to generate or transform content is not. The rules text will name this distinction explicitly so the boundary is checkable.

R2.4 Enforcement, in three layers:

1. Venue-isolated LAN: the event network serves only the platform and allowed local resources; general internet egress is restricted during the competition window so AI web services are unreachable from contestant machines. Contestant machines have no personal-hotspot privilege; spot checks treat a second device used to reach an AI service as a violation.
2. Process supervision: proctors walk the floor; the platform itself logs submission metadata (timestamps, edit patterns, session state) server-side, so reports that appear within implausible time windows flag a human review conversation, not an automatic accusation.
3. Honor clause in the rules: every participant signs the rules acknowledgment before the first submission window opens, which includes a one-sentence declaration that no AI tool was used on the main task, plus the stated penalty (disqualification of the affected submission, escalation to the organizers' discretion for repeat cases).

R2.5 What would have to change to allow AI use: a explicit organizer decision recorded as a numbered decision (no informal Slack-style flip), a version bump of the event rules with the new AI clause published before registration closes, and a platform config freeze confirming which flag states ship on event day. If organizers ever want an "AI-assisted auxiliary track" (unscored, separate prizes), the same three steps apply and the main-task prohibition stays untouched.

## 5. Provider evaluation gate for future AI scoring

This gate must pass in full before anyone flips `ai_assessment_enabled` to `true` in `backend/app/config.py` (line 48). The flag is the single kill switch; while any item below is open, it stays `False`, exactly as DEC-13 requires.

1. Privacy notice: the provider's published terms state, in language we have actually read, that our submitted content (participant reports and descriptions) is not used to train or improve models, and no human-review clause applies to our data path. Verified-example standard: the Gemini API paid-services terms meet this bar; the unpaid terms fail it explicitly.
2. Data residency and retention: a documented retention period and deletion story that fits a student event, and no requirement to route participant personal data outside the provider's contract boundary. The unpaid Gemini terms' own warning ("Do not submit sensitive, confidential, or personal information to the Unpaid Services") disqualifies any unpaid path by itself.
3. Cost cap: a hard, prepaid or hard-limited spend ceiling per event, configured at the provider level, not just in our code, so a scoring loop bug cannot create an unbounded bill on a zero-budget club account.
4. Logging: every AI scoring call is logged server-side (which report, which model, request and response digests, token counts, timestamp) before the feature is enabled, so any score can be reconstructed and audited after the fact.
5. Human override: the AI score is advisory only and is displayed as such in the UI; every human reviewer can override it, the override wins, and the platform's authoritative score remains the human one. AI never is the final judge, per DEC-13.
6. Kill switch: flipping `ai_assessment_enabled` back to `False` is tested in a rehearsal deploy and demonstrably degrades gracefully (scoring falls back to human-only flow with no errors surfacing to participants), consistent with the config file's stated degradation-order purpose.
7. Explicit sign-off: an organizer decision record documents the provider, the cap, the log schema, and the flip date; the rules text disclosed to participants states in plain language which vendor processes their report text if AI scoring is on.

Only after all seven items pass does a change set flip the flag, bump the config comment away from "off until an approved provider is verified", and record the flip in the decision log.

Mechanics note: `ai_assessment_enabled` is a field of the cached `Settings` object in `backend/app/config.py` (`get_settings` is `lru_cache` decorated), so the value is read at backend startup; enabling it is a deliberate config change plus process restart, not a live UI toggle. That is intentional for a kill switch: it makes an accidental enable unlikely and gives the config freeze in R2.5 a concrete object to freeze.

## 6. Sources

All access dates are 2026-11-22. "Opened" means the page was fetched and read directly during this research; "search snippet only" means it appeared in search results and is cited only for context, never as the sole support for a number.

1. https://github.com/openai/codex (opened): Codex CLI is a locally running terminal coding agent; repository under the Apache-2.0 License; sign-in with ChatGPT is described for Plus, Pro, Business, Edu, or Enterprise plans; API-key path noted.
2. https://community.openai.com/t/understanding-the-new-codex-limit-system-after-the-april-9-update/1378768 (opened): Codex 5-hour and weekly limit system, with user-measured Plus-plan estimates; explicitly unofficial; no free-plan figures.
3. https://geminicli.com/docs/resources/quota-and-pricing (opened): Gemini CLI free quotas: 1,000 model requests per user per day with Google login (Code Assist for individuals); 250 per day, Flash only, with unpaid Gemini API key; Vertex AI Express Mode 90 days.
4. https://geminicli.com/docs/resources/tos-privacy (opened): Gemini CLI is Apache 2.0 licensed; terms and privacy notices differ by authentication path; usage-statistics telemetry with documented opt-out.
5. https://aistudio.google.com/docs/terms (opened): unpaid Gemini API services allow Google to use submitted content and responses to improve and develop products and machine-learning technologies, with possible human review; paid services do not use prompts or responses to improve products; EEA/Switzerland/UK get paid treatment even when free.
6. https://antigravity.google/docs/plans (opened): Antigravity plans tied to Google AI plans; free baseline gets a weekly-refreshed meaningful quota, unlimited tab completions, and CLI access; no BYOK.
7. https://docs.github.com/en/copilot/get-started/plans (opened): Copilot plan list; Copilot Free limited to 2,000 completions per month with an unpublished AI-credits allowance; Copilot Student free for verified students; all plans include Copilot CLI.
8. https://github.com/orgs/community/discussions/189268 (opened): Copilot Student plan introduced March 12, 2026; free access for verified students continues; 200 monthly AI Credits and unlimited completions from June 1, 2026; auto model selection only from June 24, 2026.
9. https://github.com/orgs/community/discussions/188488 (opened): Copilot Free/Pro/Pro+ interaction data used for AI model training effective April 24, 2026 unless opted out; Student users exempt; GitHub/Microsoft AI-model personnel may access collected data.
10. https://claude.com/product/claude-code (opened, after redirect from anthropic.com/claude-code): Claude Code access requires Pro, Max, Ultra, Team, or Enterprise plans or a Console account; no free tier listed; terminal and IDE support confirmed.
11. https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth (opened): Qwen Code authentication methods; Qwen OAuth tied to an active Plus or Pro subscription; no free-tier or 2,000-per-day mention on the page as of its 2026-11-09 date.

Search snippet only (context, not primary support): https://sessionwatcher.com/guides/gemini-cli-usage-limits and https://docs.cloud.google.com/gemini/docs/quotas (Gemini CLI daily-limit reporting), https://www.cloudzero.com/blog/google-antigravity-pricing (Antigravity free tier described as zero cost), https://github.com/features/copilot/plans (Copilot Free 2,000 completions headline, matching source 7), https://github.com/education/students and https://docs.github.com/copilot/how-tos/manage-your-account/free-access-with-copilot-student (student Copilot access flow), https://opencode.ai (open-source multi-provider agent), r/LocalLLaMA thread on the formerly free Qwen OAuth tier (2,000/day), and a third-party comparison mentioning Kimi Code CLI free client with paid model usage.

Gaps stated plainly: (a) the exact Copilot Free and Student AI-credit allowance figures beyond the Student 200-credit change are not published on the pages opened; (b) Codex CLI's free ChatGPT-plan status remains unverified; the README sign-in list names paid plans only; (c) the Gemini Code Assist (personal Google account) privacy notice itself was not opened, so the confidentiality claim for that specific auth path is unverified; (d) no Kimi CLI or DeepSeek agent claim was verified from a primary page. None of these gaps affects R1 or R2, because the primary tool's quota, license, and data terms, and the participant policy, all rest on the opened sources above.
