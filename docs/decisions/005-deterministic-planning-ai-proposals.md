# ADR 005 — deterministic scheduling; AI proposes

Status: accepted with review amendments. Date: 2 October 2026.

## Context

Capacity arithmetic, collision detection, ownership, timezones, and publication safety must be testable and predictable. AI can help with judgement and language, but plausible prose is not authoritative scheduling state.

## Decision

Pure functions calculate capacity and produce predictable greedy placement previews. The user controls commitment order and acceptance. Application services enforce versions, ownership, overlaps, budgets, and current coverage. Only these services create block/outbox state.

After the core MVP, an AI-provider adapter generates a typed recommendation with rationale, proposed changes, and source revisions. Store it; display it; the user edits/rejects/accepts. Accepted proposals enter the same command path as manual operations and must pass current validation. No model receives calendar mutation tools or credentials. Implement one provider first and a fake shared contract; add a second only for an actual need.

## Alternatives and consequences

An LLM as scheduling engine makes outcomes nondeterministic and failure modes difficult to reproduce. A global optimiser might improve packing but complicates explanation and change stability. A greedy chronological algorithm can leave capacity unused; return reasons and support explicit manual adjustment rather than hiding the limitation.

AI should not be necessary for core product value. Schema-constrained output still needs semantic checks for invented IDs, collisions, stale context, bounds, and ownership. Provider failures cannot break manual planning. No vector store or autonomous-agent platform is required.

## Evidence and revisit trigger

[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) support constrained response shapes. The proposal/acceptance boundary is our architectural policy, not a provider guarantee of correctness. Revisit the deterministic heuristic only if observed useful capacity is repeatedly left unused; retain user acceptance and deterministic validation regardless of algorithm/provider.
