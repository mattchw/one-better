# ADR 023 — Weekly Review insight candidates

Status: implemented for R5F, 4 October 2026. Supersedes broad Weekly Review output in ADR 020; Calendar, scheduling acceptance and ADR 022 OAuth remain unchanged.

The R5E gate passed Review safety but failed usefulness. A fact list and safe prose did not reliably express a useful relationship. The server now assembles a small provider-independent `ReviewInsightCandidate` set from owned Review evidence and relevant following-week facts. Providers select a supplied opaque candidate ID and return only bounded interpretation and one reflection question. The server resolves the title and every Evidence bullet.

Initial relationships are planning/execution gap, amendment/execution context, repeated finalized Carry, and relevant Focus Cycle attention gap. Reflection support and following-week already-addressed context modify these relationships; they are not additional model-authored topics. Require multiple deterministic facts, keep at most six candidates and surface at most two insights, preferably one. Empty output succeeds.

Review-only context version 3 includes relevant next-week Draft/Committed budget, scheduled time and distinct human Carry intent. It does not send next-week rows or mutate next-week planning. Terminal/ineligible sources, intentional finalized Defer/Drop, changed active cycle membership and materially protected next-week attention suppress redundant candidates. A retained historical gap tells the model when next week already protects time.

Only explicit Review coaching can send approved finalized reflection bodies. Daily finalization must precede the terminal Review cutoff. Draft/late reflections, session notes and Google metadata remain excluded. Reflection is supporting user-reported context, not established causality. A conservative relevance rule attaches disruption-context reflections to matching block dates or the weekly reflection. This rule is a known limitation, not a general semantic classifier.

The closed output is `{insights:[{candidateId,interpretation,reflectionQuestion}]}`. Unknown/duplicate IDs, more than two insights, fabricated topics or disallowed prose fail closed. Existing R5E quantity/name/history/rollover checks remain, with additional causal, prescriptive and evidence-relationship guards. These guards do not establish human usefulness. UI separates Evidence, Coach and Question; it shows no chain of thought. Stale or legacy broad Review prose is hidden until explicit regeneration. Existing JSON run persistence is reused without a migration.

Anthropic's live API rejects `maxItems`. Its adapter removes only `properties.insights.maxItems` from a cloned wire schema. The shared application schema and strict two-insight validation remain intact; Calendar wire schema is unchanged. Prompts and frozen packets were not tuned per provider.

[Live evidence and independent verdicts](../r5f-weekly-review-evidence-quality.md) govern the quality gate. No automatic provider winner, scores, tools, agents, rollover, scheduling or other domain mutation are introduced.
