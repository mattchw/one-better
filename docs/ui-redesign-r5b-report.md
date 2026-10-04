# R5B — AI Coaching + Explicit Recommendation Proposals

3 October 2026. R5B only. Implementation and automated verification are complete. Live provider QA remains unverified because neither API key is configured.

## Provider architecture and exact APIs

The provider-neutral interface is `AIProvider.generateCoaching(context, schema, signal)`. Providers receive a bounded evidence packet and output schema, never repositories, application commands or tools. Official SDKs are pinned to `openai@7.27.0` and `@anthropic-ai/sdk@0.131.0`. OpenAI uses `POST /v1/responses` with `text.format` JSON schema, strict output and `store:false`. Anthropic uses `POST /v1/messages` with `output_config.format` JSON schema. Neither uses conversation history or tool calling.

Server configuration is `AI_PROVIDER`, selected provider key, and exact model ID. No model is hard-coded in domain code. Missing/incomplete configuration leaves the coach optional and disabled. Keys never enter browser props or a user-facing key database. [ADR 020](decisions/020-ai-coaching-proposals.md) records the decision, superseding broader future chat/tool-loop examples.

Official documentation checked during implementation: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Claude TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript), and [Messages API](https://platform.claude.com/docs/en/api/typescript/messages).

**Exact models exercised:** `fixture-openai` and `fixture-claude`, synthetic names served by a local deterministic HTTP fixture through the actual official SDKs. Neither is a live model. Both real API keys were absent from local server configuration; no live OpenAI or Claude model was tested and no recommendation-quality or external model-compatibility claim is made.

## Context and minimization

The owned reader composes existing Focus Cycle, Planning, Effective Plan, scheduling, availability and finished-review projections. A pure whitelist creates labelled facts with stable entity references. Context contains Current Focus title/intent/selected outcomes, selected week and pinned timezone, original/current capacity and reserve, logical commitment budgets/scheduled/remaining/recorded quantities, current-plan Action source versions, at most twelve optional eligible cycle Actions, relevant local blocks, normalized Focusable/Calendar-open intervals, coverage state and recorded outcome counts. At most four prior finished weeks supply relevant Goal attention and final Carry/Defer/Drop intent. Current-plan sources are not truncated.

Calendar sends structured facts only. Reflection bodies, Focus end/scratch notes, OAuth material, Google account/calendar identifiers, event titles/descriptions/attendees, raw provider payloads and arbitrary user database content are excluded. Explicit Weekly Review generation may include finalized weekly text and finalized daily text projected through the existing finalization cutoff. Draft text and daily reflections finalized after that cutoff never leave the app. Calendar's recent history also excludes reflection text. **What is shared?** names the destination and these rules.

No full context, prompt or chat history is persisted. Saved proposal prose and cited labels can repeat permitted facts/reflection excerpts and therefore remain private user data. Run/API reads are authenticated, owned, private and no-store. Strict bounded bodies and same-Origin protection apply to generation and preview. SDK error objects, authentication headers, inputs and raw responses are never logged. The example environment contains placeholders, including Google credentials.

## Recommendations, grounding and deterministic validation

At most three strict application-owned recommendations are accepted:

| Type | Result |
| --- | --- |
| `observation` | Bounded title/explanation and deterministic evidence references |
| `schedule_time` | Existing logical commitment, local date/times, bounded title/reason and evidence |
| `review_plan` | Supplied owned target reference, title/reason and navigation into the existing human workflow |

Provider schemas constrain closed object shapes; Zod independently enforces exact fields, types, text lengths, dates, times and count. Every evidence key and entity UUID must exist in the supplied owned packet, including UUIDs embedded in prose. Fabricated references reject the whole run. **Why?** exposes concise trusted fact labels, never chain-of-thought. Natural-language interpretation still needs user judgment; ID grounding cannot establish prose correctness.

Before displaying actionable scheduling, the existing preview checks owned current commitment, eligible week, future local interval, local overlap, lifecycle, Focusable Hours and fresh/stale/unknown Google busy advisory. Invalid proposals show an unavailable reason and no Preview button. Valid proposals offer **Preview**, not direct Apply. Preview rereads facts, rejects stale context and invokes the existing preview service again. The ordinary editor shows budget/scheduled/resulting totals, date/times, hours/busy status and unchecked warning acknowledgements.

**Schedule block** rechecks coaching freshness, then calls the existing TimeBlock creation endpoint/service with its ordinary expected Plan version, review digest, warning acknowledgements and mutation UUID. Acceptance has no AI-specific mutation endpoint. Uncertain scheduling retries the exact normal receipt. Edited times use normal placement review. Neither generation nor preview changes Goals, Actions, Plans, Amendments, blocks, Focus Sessions or review decisions. Weekly Review coaching cannot schedule history or make Carry/Defer/Drop choices. No score is added.

## Persistence, explicit generation and staleness

Additive migration `0013_ai_coaching_runs.sql` adds one private run table. Identity/scope/fingerprint/request hash/provider/model/timestamps plus terminal validated proposals, failure, latency and usage are sufficient for reload and staleness. SQL checks bound result size/state; the update trigger freezes identity and terminal results. No generic memory/conversation tables exist.

A short owner-locked pending claim guarantees one in-flight provider request per account and stable retries. Calls occur outside database transactions. Exact retry returns the same run without another call; reusing a UUID for different content conflicts. An abandoned pending claim can recover after sixty wall-clock seconds only on another explicit generation. No job, page render, navigation or keystroke invokes AI. Panel GET refreshes on relevant UI changes, visible-minute intervals and window focus are read-only.

Canonical fingerprints include relevant versions/content and normalized coverage. Plan amendments, blocks, Action lifecycle, Current Focus, hours, recorded outcomes and material busy/coverage changes stale advice. A fresh identical busy refresh remains stable despite its timestamp. Two successive evidence reads reject visibly changing packets; they are not a global atomic SQL snapshot. Final scheduling correctness still comes from the ordinary transactional command. Stale proposals remain readable, with Preview disabled until explicit refreshed generation.

## Failures and development cost

Authentication, rate limit, missing model, timeout, outage, refusal, malformed/truncated response and oversized context produce a small sanitized coach state. Core application services remain usable. Failed runs are durable; retrying the same request does not silently spend again. Refresh starts an intentional new request. SDK retries are disabled; SDK timeout is twenty-five seconds, application deadline thirty seconds with abort. Input is limited to 96,000 UTF-8 bytes, provider output to 4,096 tokens, stored results to 64,000 bytes.

Usage retains nullable input/output/cache-read token counts and latency, including refused/malformed responses when supplied. Unit/service fixtures report 123 input / 45 output tokens; SDK/browser fixtures report 100 input / 60 output / 10 cached tokens. These are synthetic values, not live spend or pricing estimates. No prominent token UI or billing was introduced.

## Verification

| Command / check | Final result |
| --- | --- |
| `npm test` | **409 passed / 30 files** |
| `npm run test:db` | **287 passed / 14 files**, isolated PostgreSQL 16 |
| `npm run test:e2e` | **144 passed**, full browser/HTTP regression, **6.2 minutes**, local OpenAI and Google fixtures |
| `AI_FIXTURE_PROVIDER=anthropic npm run test:e2e -- tests/e2e/coaching.spec.ts` | **6 passed**, **15.4 seconds**, actual Anthropic SDK against local fixture |
| `npm run lint` | Passed, zero warnings |
| `npm run typecheck` | Passed |
| `npm run docs:check` | Passed, required documents/ADR links/fences |
| `npm run db:generate` | 25 tables; no schema changes, nothing to migrate |
| `npm run build` | Passed, optimized Next.js 16.3.8 production build; compilation 4.5 seconds, TypeScript 5.9 seconds |
| `npm run test:restart` | **All seven scripts passed**, including four real coaching persistence stop/start cycles |
| Normal local migration and restart | Earlier thirteen SQL hashes matched the ledger; only additive 0013 applied. Updated production app restarted on port 3100; `/api/health` returns `200 {"status":"ready"}`. Background browser confirms the signed-out Calendar redirects to the current One Better sign-in UI. |

The three full regression suites total **840 tests**, plus six repeated coaching cases under Anthropic. Tests use local dummy credentials; no real AI request was made. Boolean-only checks of both local environment files confirmed no configured OpenAI key, Anthropic key or selected AI provider. The normal application consequently uses the calm optional coaching state.

The new production proof reads and replays the saved OpenAI run after restart, switches to Anthropic explicitly, generates/reloads its run without automatic calls, compares upstream planning/execution rows byte-for-byte, completes an Action deliberately and verifies a stale preview conflicts, then restarts with AI disabled and reads Calendar successfully. It cleans up only its disposable database, process and clock. The normal user database is not used for this fixture walkthrough.

Tests cover context privacy/cutoffs, strict parsing, fabricated IDs, grounding, stale sources/material availability, scheduling legality, provider failures/abort, disabled state, explicit-only generation, owner isolation, concurrent duplicate claims, no network-held locks, minimal durable reload, ordinary scheduling receipts/retries, unchanged upstream records, frozen terminal rows and explicit crash recovery. Official SDK fixtures assert correct endpoints/schema parameters and sanitized representative errors. Browser tests cover explicit generation/Why/reload/Preview/acceptance, stale preview after Action completion, uncertain-generation retry, provider error, selective empty output, narrow layout, optional disabled UI, finalized Review sharing and authenticated/same-Origin routes.

Initial verification found test-fixture date/cutoff and UI text expectations; these were corrected. Broader browser runs hit the existing authentication rate window. Test setup retains real sessions and the production limiter, using the established fixture helper and allowing its advertised retry window. No authentication bypass was added. The older production Goal proof now opens the existing Next actions disclosure before checking saved active/archived outcome text. The new coaching restart process explicitly clears Google configuration, preventing inheritance of the normal app's redirect for a different test port; normal credentials are unchanged. A diagnostic assertion's TypeScript overload was corrected during the final harness check.

## Screenshots and visual review

These are synthetic fixture walkthroughs, not live provider recommendations. Desktop is 1440×1000; narrow viewport 390×844. Calendar retains its viewport-height grid and independently scrolling side rail; Weekly Review stays subordinate to deterministic facts/decisions.

- [Calendar coach and cited evidence](screenshots/r5b/calendar-coach.png)
- [Ordinary scheduling preview](screenshots/r5b/schedule-preview.png)
- [Stale advice after acceptance](screenshots/r5b/stale-advice.png)
- [Sanitized provider error](screenshots/r5b/provider-error.png)
- [Mobile selective empty response](screenshots/r5b/mobile-empty.png)
- [Weekly Coach’s perspective](screenshots/r5b/weekly-perspective.png)

Visual inspection corrected a low-contrast review link and aligned the coach border with existing theme tokens. No physical-device, virtual-keyboard or full screen-reader testing is claimed.

## Remaining friction and proposed next step

Long citations or three proposals require scrolling within the Calendar rail; on narrow screens the rail shares limited height with the calendar. Model configuration currently requires editing server environment and restarting. The displayed local date/times use a compact machine-readable format. An edited AI placement still retains its original recommendation association and requires that original snapshot to be fresh; closing and scheduling manually is the existing escape. An uncertain generation command is kept in tab state; after a reload inspect the saved run before requesting another. Runs have no user-facing deletion/retention controls, chat history or price estimate.

The first evidence read is not one global transaction. Scheduling remains guarded transactionally; observations may misinterpret valid facts. Live account/model/schema compatibility, latency, token cost, selectivity and practical advice quality remain unverified without credentials. No autonomous AI, external ingestion, Calendar writing or additional feature phase was started.

**Proposed next step only:** configure one supported model at a time, complete the brief's live OpenAI and Claude QA, and dogfood the same Focus Cycle/week before authorizing further AI behavior.
