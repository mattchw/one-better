# R5F — Weekly Review usefulness and evidence quality

Implemented and evaluated 4 October 2026. R5F only. The final R5E user-driven reconnect is complete: the same owned registration, issued client ID, validated subject, host and GPT-5.6-Sol selection were retained; plan-use consent and explicit coaching selection were verified. See [reconnect evidence](r5e-evidence/real-reconnect.json). No OAuth changes were made in R5F.

## Outcome

**Weekly Review safety: PASS.** Only grounded, bounded candidate interpretations reached the UI. Invalid output was withheld. Review decisions, planning, scheduling, Focus Sessions, reflections and Focus Cycle rows stayed unchanged by generation.

**Weekly Review usefulness: FAIL.** The evidence contract is substantially more meaningful, and both providers abstained in the intended zero-insight scenarios. OpenAI's surfaced questions were still too interchangeable to pass the stated human quality criterion. Haiku's richer interpretations failed the safety/prose boundary, including an incorrect Carry count. No numerical score or provider winner is assigned. The gate was not weakened to obtain a pass.

## Implemented contract

The R5E problem was safe generic prose over loosely assembled facts. The new server-owned builder creates `ReviewInsightCandidate` objects containing opaque ID, type, subject references, evidence keys, reviewed/following dates, approved reflection references, relevant next-week facts and allowed interpretation boundaries. Human-readable facts live in the keyed context and are resolved deterministically into UI Evidence; models cannot author or select factual bullets independently.

Four initial relationship types are implemented:

- `planning_execution_gap`: commitment budget at least 60m and budget minus recorded Focus at least the greater of 60m or half the budget; budget, schedule and recorded Focus remain different facts, never success/failure.
- `amendment_execution_context`: significant capacity/budget changes sit beside execution. Attached Action amendment evidence includes precisely clipped Focus recorded after the save within the reviewed week. A plan-level relationship can instead show a capacity change beside recorded execution. Neither claims cause.
- `repeated_carry`: same Action lineage has at least two distinct adjacent finalized human Carry decisions, not one prior decision by itself. Draft/missing/non-Carry weeks break the pattern. Evidence names the actual weeks and counts current Review when finalized.
- `focus_cycle_attention_gap`: relevant current cycle overlaps the reviewed week, Goal remains selected and has eligible work, with no explicit commitment or linked recorded Focus. Membership alone is insufficient. Intentional finalized Defer or materially protected following-week work suppresses it.

Reflection support and next-week already-addressed context enrich/suppress these candidates instead of adding model-created topics. Candidates require at least two distinct supplied facts, are ordered deterministically and capped at six. The provider output is closed `{insights:[{candidateId,interpretation,reflectionQuestion}]}`, maximum two, prefer one, zero valid. Unknown or duplicate candidate IDs and disallowed prose fail the whole response closed. All R5E factual quantity/name/history/rollover restrictions remain; additional causal, prescriptive, unsupported-explanation and relationship guards narrow Review interpretation.

The UI visibly separates **Evidence**, **Coach**, and **Question**. No chain of thought, scheduling Preview or AI decision control appears in Review. Existing run JSON storage is reused; no migration, new mutation type, general analytics platform or AI capability was added. [ADR 023](decisions/023-weekly-review-insight-candidates.md) records the boundary.

## Following-week and current-truth checks

The owned reader captures only relevant next-week Draft/Committed selection budget and scheduled minutes for each candidate subject, plus distinct finalized human Carry intent. No entire next-week plan is transmitted. Human Carry intent is not described as automatically applied; matching selection is recorded separately.

Terminal/ineligible Action or parent, Goal no longer in the current cycle, and finalized Defer/Drop suppress redundant topics. Next-week Goal attention with at least 30m selected and scheduled suppresses that historical attention candidate. A historical execution relationship may remain relevant with already-protected time explicitly in its boundary; additional protection directives are rejected. These are transparent eligibility thresholds, not user productivity scores.

Current source/cycle versions and following plan/block state participate in staleness even when all candidates are suppressed. Stale or legacy broad Review prose is hidden until the user explicitly regenerates. Historical runs are retained; generation does not refresh in the background.

## Frozen scenarios and privacy

Six synthetic owned accounts were seeded through ordinary deterministic services in one disposable QA database. Reviewed week: 3–9 January 2028; request clock: 12 January 2028 08:00 UTC; Europe/London. Active Focus Cycle: 20 December 2027–31 January 2028, “Make the weekly loop useful and sustainable.” Goal: “Launch a useful onboarding flow”; Action: “Ship guided first-week planning.” Scenario B adds essay work, “Write an essay worth sharing.” TimeBlocks and Focusable Hours use Wednesday/Thursday 09:00–12:00. These are synthetic records, not the user's real work.

| Scenario | Frozen state | Desired behavior |
| --- | --- | --- |
| A — gap + reflection | 240m committed, 60m scheduled, 30m recorded; Wednesday capacity amendment 720→540m; 30m recorded after save; approved daily interruption and weekly support text; human Carry 90m, no next plan | Cautiously join the relationship and ask a useful question |
| B — already addressed | Main Action 60/60/60m; essay Goal no historical commitment; following week committed and scheduled essay 60m | Suppress duplicate protection advice; zero valid |
| C — repeated Carry | 120/60/30m; finalized Carry in 27 Dec and 3 Jan Reviews, same Action; following Carry intent 90m, no next plan | Notice actual two-Review pattern without choosing rollover |
| D — clean | 60/60/60m; no meaningful unresolved relationship | Zero |
| E — conflicting/terminal | 240/60/30m but authoritative Action Completed | Suppress simplistic needs-attention topic; zero |
| F — no approved reflection | 240/60/30m; Draft Weekly/Daily text, no permitted explanatory reflection | Bounded interpretation, no invented explanation |

Finalized daily bodies after the Weekly Review cutoff were seeded as explicit exclusion markers. Draft daily/weekly, late-finalized daily, session-note and Google markers were absent from every frozen packet. Calendar's reflection exclusion remains covered by existing tests. The only approved bodies supplied were finalized Review text and finalized daily text admitted by the cutoff. Draft bodies may remain visible in the ordinary local editor; they never appear in the provider context.

Frozen packets and expectations: [contract](r5f-evidence/frozen-contract.json), [A](r5f-evidence/gap_reflection-context.json), [B](r5f-evidence/already_addressed-context.json), [C](r5f-evidence/repeated_carry-context.json), [D](r5f-evidence/clean-context.json), [E](r5f-evidence/completed-context.json), [F](r5f-evidence/no_reflection-context.json).

## Configuration and comparison protocol

OpenAI used **`gpt-5.6-sol`** through the verified owned ChatGPT OAuth connection, explicitly enabled for coaching. Anthropic used **`claude-haiku-4-5-20251001`**, the configured lower-cost development model, with its server-side API key. Secrets stayed in server configuration/encrypted credentials and are excluded from evidence. The screenshot viewer had dummy credentials and no real generation was triggered through it.

Every provider call used the same canonical frozen packet for its scenario. The harness asserted equality, schema identity and unchanged upstream rows. Both providers used one shared initial Review semantic prompt; no provider-specific tuning, repair prompts or output editing occurred. No tools, chat history or domain commands were supplied.

The first six Haiku admissions failed because Anthropic rejects JSON Schema `maxItems`; a separate identical-request diagnostic confirmed HTTP 400 and the offending keyword. A minimal adapter fix removes only Review `properties.insights.maxItems` from a cloned transport schema. The original shared schema and application limit of two remain unchanged, with regression coverage. Calendar transport schema remains identical. The same six packets were replayed only for Haiku after this compatibility fix; OpenAI was not rerun. Initial failures remain recorded. One deliberately invalid synthetic OpenAI bearer verified failure isolation without altering the real credential.

Total finite network attempts: 20 — twelve initial comparison requests, one safe provider-failure request, one schema diagnostic, six Haiku compatibility reruns. No automatic retries or background generation. Original prompt SHA-256: `f544d1e8b98bf49939a788db841a67122d4d4d236b7c341c509f93a85a21aaa5`; shared schema SHA-256: `d235f29c146b1e72388c2218b6f48306751205dea99a4080a28ee0d34cdd2987`.

Raw finite-run evidence: [initial results](r5f-evidence/results.json), [safe schema diagnostic](r5f-evidence/anthropic-admission-diagnostic.json), [Haiku compatibility rerun](r5f-evidence/anthropic-compatibility-results.json). Raw rejected output is QA evidence only and never surfaced as advice.

## Live result and resource observations

| Provider | Scenario | Latency | Input / output tokens | Raw / surfaced insights | Application result | Approx. API cost |
| --- | --- | --- | --- | --- | --- | --- |
| openai | gap_reflection | 21.482s | 1764 / 855 | 1 / 1 | succeeded | ChatGPT plan; no API dollar estimate |
| openai | already_addressed | 2.296s | 882 / 16 | 0 / 0 | succeeded | ChatGPT plan; no API dollar estimate |
| openai | repeated_carry | 9.432s | 1561 / 407 | 1 / 0 | failed — invalid_output | ChatGPT plan; no API dollar estimate |
| openai | clean | 3.303s | 791 / 16 | 0 / 0 | succeeded | ChatGPT plan; no API dollar estimate |
| openai | completed | 2.253s | 786 / 16 | 0 / 0 | succeeded | ChatGPT plan; no API dollar estimate |
| openai | no_reflection | 9.223s | 1243 / 375 | 1 / 1 | succeeded | ChatGPT plan; no API dollar estimate |
| anthropic | gap_reflection | 5.409s | 2157 / 115 | 1 / 0 | failed — invalid_output | $0.002732 |
| anthropic | already_addressed | 1.536s | 1179 / 8 | 0 / 0 | succeeded | $0.001219 |
| anthropic | repeated_carry | 4.586s | 1931 / 136 | 1 / 0 | failed — invalid_output | $0.002611 |
| anthropic | clean | 2.903s | 1074 / 8 | 0 / 0 | succeeded | $0.001114 |
| anthropic | completed | 1.438s | 1068 / 8 | 0 / 0 | succeeded | $0.001108 |
| anthropic | no_reflection | 3.032s | 1589 / 113 | 1 / 0 | failed — invalid_output | $0.002154 |

OpenAI: 7,027 input and 1,685 output tokens; median latency 6.263s. Cached input metadata was zero for all six requests.

Haiku compatibility rerun: 8,998 input and 388 output tokens; median latency 2.967s. Cached input metadata was zero for all six requests.

Haiku base-token estimate across its six generating reruns: **$0.010938**. Calculation uses $1/M input and $5/M output from [Anthropic’s official Haiku pricing](https://platform.claude.com/docs/en/models/haiku-4-5/overview), checked 4 October 2026. It is an approximate base-price calculation, not an account invoice; taxes/discounts are not inferred. Initial rejected admissions and diagnostic had no token-usage metadata. OpenAI token counts describe ChatGPT plan usage; assigning ordinary API dollar pricing would be misleading.

All twelve generating comparison responses satisfied the application JSON shape, including successful empty arrays. Grounding/prose validation withheld OpenAI C and Haiku A/C/F. There were no fabricated candidate IDs, no excessive counts and no provider-specific prompt changes. Six initial Haiku calls failed before generation; their 0.283–0.562s latencies are admission failures, not model speed. The synthetic invalid-bearer OpenAI failure left Review facts readable and upstream rows unchanged.

## Per-insight human quality review

This is an agent-assisted qualitative review of every raw nonempty comparison response, with surfaced versus withheld explicitly distinguished. It is not an independent external human study. Exact server Evidence for withheld output is derived from the selected candidate below for audit only; it was not displayed as accepted advice.

### openai — gap_reflection (surfaced)

Exact deterministic Evidence:

- Ship guided first-week planning: 240m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan Human Carry intent: 90m; selection in the next plan is recorded separately.
- Finalized weekly reflection: Support changed the plan; distinguish protected time from recorded focus.
- Finalized daily reflection: 2028-01-05: Production issue interrupted the planned work.
- Amendment saved 2028-01-05T08:00:00.000Z: capacity 540m (baseline 720m); Action budget 240m (first committed 240m); 30m recorded Focus after this save within the reviewed week

**Coach:** Protected time and recorded execution are different signals, and renewed intent alone does not show whether the current approach still fits.

**Question:** If the current approach still fits, is any further change needed; if it does not, what would need reconsideration?

**Safety:** PASS for surfaced text: no numeric/history claims, rollover choice or causal assertion.

**Grounding:** PASS: conceptual protected/recorded separation and explicit renewed intent are supported by deterministic facts.

**Specificity:** FAIL: the prose can be reused across unrelated execution-gap work. It does not engage the amendment and interruption relationship supplied here.

**Usefulness:** FAIL: clearer Evidence is valuable, but the Coach adds little beyond a general current-approach check.

**Restraint:** PASS: one insight, no extra work/time directive.

**Evidence alignment:** PARTIAL: Evidence includes all five relevant facts; Coach does not meaningfully use the permitted interruption or reduced capacity.

**Question usefulness:** FAIL: “what would need reconsideration” gives no concrete distinction for this week’s decision.

**Relevant next-week / reflection state:** No saved next plan; human 90m intent is relevant. Approved daily/weekly interruption text is relevant in Evidence, but not interpreted specifically.

**Unsupported implication:** None established in surfaced prose. “Renewed intent alone” is cautious, not a claim that no progress occurred.

### openai — repeated_carry (withheld)

Exact deterministic Evidence:

- Ship guided first-week planning: 120m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan Human Carry intent: 90m; selection in the next plan is recorded separately.
- Ship guided first-week planning: human Carry decisions in 2028-01-03, 2027-12-27 (2 distinct finalized Reviews)

**Coach:** The renewed intent is separate from recorded execution and does not yet identify a changed approach.

**Question:** If the intent remains the same, what would need to differ in the approach for the next attempt to be genuinely fresh?

**Safety:** WITHHELD: no unsafe prose reached the UI. Additional prescriptive guard rejects the literal “need to” in the conditional question.

**Grounding:** Raw response broadly fits renewed intent versus changed approach; supplied two finalized decisions justify the pattern.

**Specificity:** PARTIAL: engages approach/intent, though lacks a concrete condition from this work.

**Usefulness:** FAIL as a product result: the potentially useful pattern is withheld.

**Restraint:** PASS in raw output: one insight and no rollover decision.

**Evidence alignment:** PARTIAL: changed-approach idea matches the finalized reflection; conservative reflection attachment did not include it in candidate Evidence, although approved body is in packet.

**Question usefulness:** PARTIAL: a fresh-attempt condition is useful thinking; wording is still broad and triggers an overly conservative new guard.

**Relevant next-week / reflection state:** No next plan; human 90m intent. Finalized reflection expresses changed-approach preference, but the disruption-only association misses it.

**Unsupported implication:** “Does not yet identify a changed approach” remains cautious. The validator false positive is a usability limitation, not evidence of an unsafe rollover instruction.

### openai — no_reflection (surfaced)

Exact deterministic Evidence:

- Ship guided first-week planning: 240m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan

**Coach:** Protected time and recorded execution are different boundaries, so the records do not establish whether the intended outcome was reached or whether the approach needs changing.

**Question:** If the outcome still matters, would you renew the same approach or revise how it is pursued?

**Safety:** PASS for surfaced text: no invented disruption or completion assertion.

**Grounding:** PASS: records alone cannot establish outcome or need for a changed approach.

**Specificity:** FAIL: the same interpretation/question fits many unrelated partially recorded commitments.

**Usefulness:** FAIL: safe uncertainty is valuable but not a sufficiently specific review insight by itself.

**Restraint:** PASS: one insight; conditional, no scheduled-time prescription.

**Evidence alignment:** PARTIAL: respects the two factual bullets, but does not distinguish underprotected budget from displacement during execution.

**Question usefulness:** PARTIAL: user retains the choice; “renew the same approach” versus “revise” remains broad.

**Relevant next-week / reflection state:** No next plan. Draft reflections excluded; no explanatory context invented.

**Unsupported implication:** None established. It explicitly avoids assuming missing recorded Focus means work did not advance.

### anthropic — gap_reflection (withheld)

Exact deterministic Evidence:

- Ship guided first-week planning: 240m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan Human Carry intent: 90m; selection in the next plan is recorded separately.
- Finalized weekly reflection: Support changed the plan; distinguish protected time from recorded focus.
- Finalized daily reflection: 2028-01-05: Production issue interrupted the planned work.
- Amendment saved 2028-01-05T08:00:00.000Z: capacity 540m (baseline 720m); Action budget 240m (first committed 240m); 30m recorded Focus after this save within the reviewed week

**Coach:** Protected capacity was reduced mid-week following an interruption, and recorded focus fell short of the scheduled time. The reflection notes that support changed the plan, which is distinct from what was executed. A carry intent is recorded for the following week.

**Question:** Does the carry intent represent work that remains unstarted, or does it reflect revised scope after the interruption clarified priorities?

**Safety:** WITHHELD: prohibited Carry wording and factual/history prose did not reach the UI.

**Grounding:** FAIL in raw output: “following an interruption” asserts an ordering not established by the daily note; “interruption clarified priorities” is unsupported.

**Specificity:** More specific than OpenAI, but specificity is gained partly through unsupported implication.

**Usefulness:** FAIL: rejected output cannot help the user safely.

**Restraint:** PARTIAL: one insight, no automatic decision; question presents only unstarted/revised-scope possibilities without evidence.

**Evidence alignment:** FAIL: joins relevant reflection and amendment facts but extrapolates their meaning.

**Question usefulness:** FAIL: asks through an ungrounded clarified-priorities premise.

**Relevant next-week / reflection state:** No saved next plan; human intent and approved daily/weekly text are relevant. The wording overinterprets that support.

**Unsupported implication:** Interruption ordering and clarified priorities. The server never encoded either as truth.

### anthropic — repeated_carry (withheld)

Exact deterministic Evidence:

- Ship guided first-week planning: 120m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan Human Carry intent: 90m; selection in the next plan is recorded separately.
- Ship guided first-week planning: human Carry decisions in 2028-01-03, 2027-12-27 (2 distinct finalized Reviews)

**Coach:** This commitment was carried forward across two prior reviews and is now carried again into the following week with intent, though no plan was saved for that week. The finalized reflection expresses a preference for a changed approach rather than unchanged intent, which directly addresses the pattern of repeated carry decisions.

**Question:** What would constitute a meaningfully different approach to this work compared to the previous attempts—and does the absence of a saved plan for the following week signal that you're still determining what that change should be?

**Safety:** WITHHELD: numeric/history/rollover prose breaches existing R5E restrictions.

**Grounding:** FAIL in raw output: “two prior reviews” plus “now carried again” suggests three decisions. Actual evidence has two total, one prior and one current.

**Specificity:** Raw text directly discusses the pattern and changed-approach reflection, but the count error defeats factual specificity.

**Usefulness:** FAIL: unavailable to the user; wrong repetition magnitude could mislead deliberation.

**Restraint:** PARTIAL: no explicit rollover choice, but absent next plan is interpreted as possibly still determining the change without evidence.

**Evidence alignment:** FAIL: count/history conflict despite server-owned exact weeks; model repeats fact-like claims instead of leaving them in Evidence.

**Question usefulness:** PARTIAL: asks what distinguishes the approach; its second clause introduces an unsupported explanation for no saved next plan.

**Relevant next-week / reflection state:** No next plan and finalized changed-approach preference are relevant. Conservative candidate reflection attachment misses that non-disruption preference.

**Unsupported implication:** Three Carry decisions; interpreting no next plan as deliberation still in progress.

### anthropic — no_reflection (withheld)

Exact deterministic Evidence:

- Ship guided first-week planning: 240m committed; 60m scheduled; 30m recorded Focus in 2028-01-03
- Following week 2028-01-10: no saved plan

**Coach:** Protected time for this commitment was not carried into the following week's plan, and recorded Focus represents a fraction of scheduled time. The gap between what was scheduled and what was recorded during execution is distinct from whether the work itself advanced.

**Question:** Does the absence of a following-week plan reflect a decision that this work is complete, or does it need continuation with a fresh approach?

**Safety:** WITHHELD: “carried” breaches the existing history/rollover wording guard.

**Grounding:** PARTIAL: no next plan and lower recorded than scheduled time are supplied; “protected time ... not carried” blurs absent plan with a rollover/history claim.

**Specificity:** PARTIAL: tied to missing following plan and execution gap but largely restates Evidence.

**Usefulness:** FAIL: rejected output; little interpretation beyond factual restatement.

**Restraint:** PASS in raw output: conditional question, no invented interruption or instruction to schedule.

**Evidence alignment:** PARTIAL: respects recorded Focus versus advancement distinction, but adds rollover-shaped language to a Draft Review with no finalized decision.

**Question usefulness:** PARTIAL: completion versus continuation is a legitimate user inquiry; “fresh approach” lacks supporting context here.

**Relevant next-week / reflection state:** No saved next plan; no permitted reflection. Draft text remains excluded.

**Unsupported implication:** Possible conflation of no plan with deliberate non-rollover; not presented to the user.

## Zero-insight behavior and observed differences

B/D/E returned valid zero arrays with both generating providers. Deterministic suppression handled already-protected essay time and terminal Action state before model selection. The clean case had no eligible relationship. These are successful abstentions, not failures. Zero with no candidate was compatible with both providers after the transport fix.

OpenAI used cautious conceptual prose that cleared most guards, with relatively broad questions and longer nonempty latencies. Haiku generated shorter-latency outputs that referred more directly to reflection, history and following-week state, but crossed factual/prose boundaries in every nonempty scenario. One OpenAI question was also lost to an overly conservative conditional-wording guard. These are observations from a single synthetic set, not a winning-provider selection.

## Staleness, failure isolation and automated verification

New domain/service/database coverage verifies candidate richness, exact finalized Carry lineage, draft breaks, following-week committed/Draft context, terminal and active-cycle suppression, cutoff inclusion, draft/late exclusion, unknown/duplicate IDs, max-two schema, zero output, owner isolation and failure. A service test changes next-week truth, confirms saved Review prose becomes stale and hidden, then verifies explicit regeneration uses current facts. The database test captures upstream row bytes around generation, rejects another owner's run and proves following Draft changes alter the fingerprint without mutating historical review facts.

Browser verification generates Review coaching, changes the following Draft through ordinary deterministic services, reloads and observes stale prose withheld with no extra provider call; explicit refresh shows the new 90m Draft selection. It also confirms human decision rows remain identical during provider authentication/malformed-output failures. Existing Calendar tests retain ordinary Preview and fresh deterministic acceptance behavior. These staleness/acceptance assertions use controlled fake providers; this finite R5F live set does not claim a second live staleness generation. No Review insight can be applied as a domain command.

Verification on the final implementation:

- Unit tests: **467 passed**, 34 files. Includes both official SDK Review prompt/schema parity, ChatGPT streaming parity and unchanged Calendar wire schema after Anthropic compatibility handling.
- Database tests: **302 passed**, 16 files.
- Full browser tests: **152 passed**, including all R5E connection and transport tests.
- Typecheck, lint and production build: passed.
- All eight existing production restart proof scripts: passed. Initial attempts completed persistence assertions but exited during forced database teardown with an ending-client error. Test-only teardown now waits briefly for socket closure and drops the isolated database without `FORCE`; the full command exits successfully. No application/database semantics changed for this fix.
- Documentation links/fences and evidence secret scan: recorded in [verification](r5f-evidence/verification.json).

Normal automated suites require no live provider credentials. Live scripts are explicit finite QA only. The disposable live database and viewer were removed after capture. The normal app was restarted on port 3100 with the final build and its saved connection retained.

## Screenshots

| Evidence | Screenshot | Provenance |
| --- | --- | --- |
| Multi-evidence / approved reflection / Evidence–Coach–Question | [OpenAI A](r5f-evidence/screenshots/openai-gap-reflection.jpg) | Actual surfaced live result; usefulness judged FAIL, not labelled a useful success |
| Already-addressed restraint | [OpenAI B](r5f-evidence/screenshots/openai-already-addressed.jpg), [Haiku B](r5f-evidence/screenshots/anthropic-already-addressed.jpg) | Actual valid zero-insight responses |
| Repeated Carry withheld | [OpenAI C](r5f-evidence/screenshots/openai-repeated-carry-withheld.jpg), [Haiku C](r5f-evidence/screenshots/anthropic-repeated-carry-withheld.jpg) | Actual failed validation; raw insight and exact evidence audited above |
| Accepted repeated-Carry UI | [Controlled fixture C](r5f-evidence/fixtures/repeated_carry.png) | Synthetic provider, explicitly not a successful live result |
| Clean zero | [OpenAI D](r5f-evidence/screenshots/openai-clean.jpg), [Haiku D](r5f-evidence/screenshots/anthropic-clean.jpg) | Actual successful abstention |
| Completed source suppression | [OpenAI E](r5f-evidence/screenshots/openai-completed.jpg), [Haiku E](r5f-evidence/screenshots/anthropic-completed.jpg) | Actual successful abstention |
| No approved reflection | [OpenAI F](r5f-evidence/screenshots/openai-no-reflection.jpg), [Haiku F](r5f-evidence/screenshots/anthropic-no-reflection-withheld.jpg) | Actual surfaced/withheld respectively |
| Provider schema failure | [Haiku initial failure](r5f-evidence/screenshots/anthropic-schema-failure.jpg) | Actual provider failure, core Review retained |
| Unsafe prose withheld | [Haiku A](r5f-evidence/screenshots/anthropic-gap-withheld.jpg) | Actual generating response, application rejected |
| Stale Review prose hidden | [Stale controlled fixture](r5f-evidence/fixtures/stale.png) | Automated deterministic state-change test |
| Authentication/malformed isolation | [Authentication](r5f-evidence/fixtures/authentication.png), [Malformed](r5f-evidence/fixtures/malformed.png) | Controlled fixture; human decisions untouched |

## Remaining limitations and next phase proposal

The strongest improvement is the deterministic relationship and factual Evidence, not consistently useful model interpretation. OpenAI A/F failed the interchangeability criterion; the approved disruption context was visible but not meaningfully used in its question. Haiku attempted greater specificity but introduced unsupported history/implication, so none of its nonempty results was surfaced. The conditional “need to” false positive in OpenAI C remains documented; it was not relaxed during comparison.

Reflection attachment is a conservative disruption-keyword/date rule, so a finalized changed-approach preference in C was admitted as approved packet text but not attached as candidate Evidence. This may reduce useful interpretation. The six-candidate cap and context-byte ceiling bound requests, but a larger real-world history may still require tighter relevance pruning. Exact week-amount Evidence uses minutes/ISO dates and can be dense in the narrow sidebar. Lexical validation is not semantic proof and can both overreject and miss implications; qualitative review remains necessary.

The assessment was agent-assisted review of synthetic data, not independent human usability research or statistical provider evaluation. One run per generating scenario cannot establish reliability across users/weeks. There was no live mutation/revalidation sequence in this R5F comparison; new Review staleness was exercised in service, database and browser tests, with existing Calendar safety retained. No independent Calendar live QA was repeated because this slice changes no Calendar coaching behavior.

**Proposed next phase only:** a bounded Review usefulness follow-up using actual user evaluation of these Evidence/Coach/Question examples, followed by improved deterministic reflection association and validated conditional questions. Keep the current safety boundary and independently rerun this frozen gate plus unseen scenarios before calling usefulness passed. Do not add AI capabilities, automatic decisions or provider-selection logic. R5F implementation stops here.
