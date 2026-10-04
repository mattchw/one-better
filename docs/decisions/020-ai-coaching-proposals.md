# ADR 020: optional coaching over owned facts, with explicit proposals

Status: implemented for R5B, 3 October 2026.

## Decision

Keep deterministic services authoritative. A narrow `AIProvider.generateCoaching(context, schema, signal)` returns unknown structured output plus usage. OpenAI Responses and Anthropic Messages adapters alone translate SDK objects. Neither receives repositories, application commands, tools, calendar adapters, other integration credentials or conversation history. Official SDK versions are pinned; exact models are server environment configuration, with no implicit default.

The reader composes existing owned projections, then a pure whitelist creates purpose-specific facts. Current Focus and selected outcomes, original/current capacity and reserve, logical commitments, independent budget/scheduled/recorded totals, relevant Action versions, local blocks and normalized Focusable/Calendar-open intervals remain distinguishable. Optional eligible cycle Actions are limited to twelve; recent history to four weeks. Current-plan sources are not truncated. Unknown/stale coverage never means free time. Identical fresh busy refreshes do not invalidate advice solely because their fetch timestamp changes.

Calendar excludes every reflection body and session note. Explicit Weekly Review requests may include finalized weekly text and finalized daily text already projected through the terminal review's cutoff. Drafts, later-finalized daily bodies, raw events, attendees, Google identifiers, OAuth state and secrets are excluded before a provider call. The panel explains the provider destination and shared data near the explicit generation button.

## Proposal and acceptance boundary

At most three `observation`, `schedule_time`, or `review_plan` proposals are permitted. Closed provider JSON schemas constrain shape; strict Zod independently checks lengths, dates, times, fields and count. Every evidence key/entity reference must exist in the supplied owned packet; UUIDs in prose are checked too. Fabricated references reject the entire run. Grounding validates references, not the accuracy of every natural-language interpretation.

Scheduling uses the existing preview before a proposal becomes actionable. Invalid dates, removed commitments, overlap and lifecycle restrictions render it unavailable. Advisory hours/busy warnings remain explicit. Preview fetches fresh facts, rejects a stale fingerprint, rechecks placement, and opens the ordinary TimeBlock editor with that deterministic result. Immediately before new acceptance the editor checks the coaching snapshot again, then sends the existing scheduling command with expected Plan version, review digest, explicit acknowledgements and ordinary mutation receipt. An uncertain scheduling response retries that exact receipt. Editing proposed times uses normal placement review. Weekly Review proposals cannot schedule historical work.

`review_plan` only navigates to an existing workflow. No AI endpoint creates Actions, amends Plans, decides Carry/Defer/Drop, writes Google Calendar or exposes a chat/tool loop. No Plan Strength or productivity score is added.

## Durable generation and concurrency

`ai_recommendation_run` stores owner-scoped operation UUID, scope/week, SHA-256 context fingerprint/request hash, provider/model, generation/creation timestamps, pending/succeeded/failed state, validated proposals with cited labels, sanitized failure kind, latency and available usage. Full prompts, context snapshots and message histories are not stored. Generated prose may quote facts or permitted finalized text, so saved advice remains private user data.

A short claim transaction uses the established stable User `NO KEY UPDATE` lock. One pending request per owner prevents clicks across tabs/scopes multiplying cost. Network calls happen after that transaction ends. Exact retries read the same durable result; changed payloads for that UUID conflict. A crash leaves a pending claim. Only another explicit generation command marks claims older than sixty wall-clock seconds failed and starts a new attempt. Claim age/order uses real database time, independently of the guarded product-test clock. SQL checks and a trigger freeze identity and terminal results.

Canonical fingerprints change with relevant plan/source/cycle/hour/block/execution/availability facts. Two successive assembled packets are compared to reject visibly changing facts; each source retains existing owned transactions. This is not one global SQL snapshot, and state can change immediately afterward. Fresh preview plus the existing scheduling command's final transaction enforce correctness at acceptance. Panel reads check staleness on source refresh, window focus and a visible-minute interval; these never call AI.

## Configuration, failure and resource bounds

`AI_PROVIDER=openai|anthropic` and the selected key/exact model enable coaching. Missing/incomplete configuration is a calm optional empty state. Keys and SDK construction stay server-only. Explicit official base URLs prevent unrelated SDK environment overrides redirecting credentials. The HTTP fixture override requires a loopback isolated `execution_test_*` database, local app origin and both known dummy keys; production credentials cannot use it.

Input is capped at 96,000 UTF-8 bytes; output at 4,096 provider tokens and three bounded proposals. SDK retries are disabled. SDK timeout is twenty-five seconds; application deadline thirty seconds with abort. Authentication, rate limit, model unavailable, refusal, malformed/truncated output, timeout and outage produce sanitized failures. Raw errors, headers, prompts and responses are not logged. Usage is retained for malformed/refused responses when supplied. Billing, pricing estimates, budgets and retention/erasure UI are outside R5B.

## Verification

Tests use fake providers and representative official SDK HTTP responses. Live-key QA is reported separately. See [R5B report](../ui-redesign-r5b-report.md) for exact results and screenshots. Fixture model names are not public-model or recommendation-quality claims.

## R5D amendment: hardened recommendation contract

R5C found past times, invented historical claims and poor restraint in real Haiku output. R5D supersedes the free-form `schedule_time` contract with `schedule_candidate`. The server now derives possible slots and decision signals, resolves all quantities/headings/navigation targets, and displays Evidence separately from Coach rationale. Candidates require fresh Calendar coverage, configured Focusable Hours, actionable effective membership and future starts, and pass the ordinary deterministic preview before transmission. At most six alternatives and twelve signals are supplied. Duplicate signal advice, unknown candidate/signal/evidence IDs, and prohibited numerical/temporal/history prose reject the whole response. Fully scheduled signals are factual context and cannot independently support advice. Zero recommendations succeeds.

The full whitelist state hash preserves staleness for relevant source, block, hour, history and plan changes; raw history/block/source rows and estimates no longer reach the provider. Request time is captured once across double reads. Expired candidates and local-day rollover invalidate the packet without churning fingerprints on every clock tick. R5B saved runs remain private historical data and become stale under schema version 2; their old scheduling payloads cannot reach Preview. SDK interfaces, server-key configuration, persistence tables and human acceptance paths are unchanged. No OAuth or new capabilities are added. See [R5D report](../r5d-ai-quality-hardening-report.md) for thresholds, live QA and the conservative prose guard's remaining false-positive/unsupported-claim risks.

## R5E amendment: credential source and streaming compatibility

An explicit owned ChatGPT OAuth registration may supply OpenAI credentials through the same R5D coaching contract. Better Auth stays authoritative. Exact account catalog selection, rotating refresh serialization and disconnect are defined in [ADR 022](022-chatgpt-plan-connection.md). OAuth inference omits unsupported request fields, uses array input and waits for terminal completion, retaining completed stream items when the terminal envelope omits output. The API-key adapter's output-token setting does not apply to the constrained plan route; local response-size limits and deadlines remain. Prompt, structured schema, prose/reference validation, candidate policy, acceptance and Review decisions are unchanged. Live Calendar and Review quality are separate gates in [R5E report](../r5e-chatgpt-openai-live-qa.md).
