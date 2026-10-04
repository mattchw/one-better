# R5G — Weekly Review Coach usefulness experiment

Date: 4 October 2026. Scope: development/QA comparison only.

**Status: implementation and automated comparison complete; explicit user evaluation pending.** No product recommendation is finalized until the user answers. Automated test selections and the agent's R5F assessment are not substitutes for those answers.

## Experiment and completion boundary

R5F demonstrated safe but insufficiently useful generative Review coaching. R5G asks whether generation earns a place beyond deterministic Evidence and a reviewed question. Compare the same six frozen R5F scenarios:

| Variant | Presentation |
| --- | --- |
| A | Deterministic Evidence and permitted reflection context only |
| B | Identical Evidence/reflection + a reviewed deterministic question when one fits an eligible candidate |
| C | Identical Evidence/reflection + existing validated AI Coach/Question, including zero or withheld states |

The comparison is a separate loopback QA workspace at `http://127.0.0.1:3106/`, launched with `npm run qa:r5g`. It is not a normal app route or user feature. The executable refuses production mode, binds only 127.0.0.1 and serves synthetic frozen data. Ordinary Review, Calendar and all application mutations remain unchanged. No schema, recommendation type, prompt, model, transport, provider selection, agent, chat, rollover or scheduling capability was added.

No new provider calls were made. C replays GPT-5.6-Sol from the original R5F ChatGPT comparison and optionally the same scenario's saved Claude Haiku 4.5 compatibility result. The UI labels the model and saved provenance. Choosing another C sample clears that scenario's ratings to prevent attributing an earlier judgment to a different provider. The experiment records the chosen C sample with each user response.

## Frozen input and safety

Source packets are the exact six JSON artifacts under [R5F evidence](r5f-weekly-review-evidence-quality.md), not reseeded or rewritten histories. Reviewed week: 3 January 2028; synthetic request clock: 12 January 2028. Each scenario's brief is authored from the frozen R5F fixture and is identical across presentations. Titles, evidence bullets and approved reflection bodies are shared by A/B/C.

| Scenario | Candidate/evidence state | B question | Existing OpenAI C | Existing Haiku C |
| --- | --- | --- | --- | --- |
| Gap + reflection | 240m committed / 60m scheduled / 30m recorded; capacity amendment; approved interruption/support notes; next Carry intent distinct from no next plan | Reflection-supported question | One accepted insight | Withheld |
| Following week addressed | Historical essay attention gap suppressed because next week already commits/schedules essay time | None; suppressed topic stays suppressed | Zero | Zero |
| Repeated finalized Carry | Same Action, two actual finalized decisions total; current + prior Review | Repeated-Carry question | Withheld | Withheld |
| Clean week | 60/60/60m; no unresolved eligible topic | None | Zero | Zero |
| Action completed | 240/60/30m but authoritative Completed state suppresses simplistic attention advice | None | Zero | Zero |
| No permitted reflection | 240/60/30m; Draft reflection excluded | Planning/execution question | One accepted insight | Withheld |

C is rechecked using the unchanged R5F closed output schema, supplied-ID grounding, duplicate rejection, maximum-two cap, strict prose validation and saved-run fingerprint. Failed/stale output is not sent to the browser. The raw rejected text remains in R5F audit artifacts only. A saved AI zero response is a valid comparison state, not a generation failure. A/B do not resurrect a suppressed topic merely to fill the comparison.

The experiment loader verifies all excluded marker classes remain absent: Draft Daily/Weekly bodies, reflections finalized after the cutoff, Focus Session notes, Google metadata. Permitted finalized reflection text is presented consistently across all three variants as local explicit Review context. No new reflection text or inference is supplied to a provider. The ordinary application's ownership, current-truth, privacy and staleness contracts are frozen.

These are frozen replay views, not advice freshly validated against the user's current real week. The harness offers no apply or Review-decision mutation. Its replay function hides AI output when the supplied current fingerprint differs. The deterministic question function likewise returns no question for stale state. Existing R5F service/database/browser freshness evidence remains authoritative for normal application operation.

## Reviewed deterministic question library

[review-questions.ts](../src/modules/coaching/review-questions.ts) is an experiment-only library, not imported by normal Review UI. Four existing candidate types have reviewed questions. Two existing context conditions select more relevant wording; these are question-library keys, not new recommendation types.

| Existing relationship/context | Exact question |
| --- | --- |
| `planning_execution_gap` | Did this work lack protected time, or is there work or displacement that the Focus record does not capture? |
| `amendment_execution_context` | Did the revised capacity change what you intended to protect, and does the recorded execution suggest the next budget needs adjusting? |
| `repeated_carry` | What keeps this work worth another Carry decision, and what would make a new attempt different from renewing the same intent? |
| `focus_cycle_attention_gap` | Was giving this Goal no weekly commitment intentional, or does its place in the current Focus Cycle need to change? |
| Approved reflection supporting an eligible gap/amendment | Does the reflection point to displaced protected time, or to a change the plan itself needs? |
| An eligible historical relationship already has selected/scheduled next-week time | With time already protected in the following week, has that plan addressed this pattern, or is a different change still needed? |

Selection: require an existing candidate and at least two distinct present evidence references. Already-protected following-week wording takes precedence over relevant reflection wording, then the existing type. Reflection references must belong to the supplied candidate Evidence. Unknown type, missing/thin Evidence, suppressed candidate, Calendar purpose or stale state produces **no question**; there is no generic fallback. At most the existing two surfaced candidate topics are compared.

The wording was reviewed for the R5F boundaries: it does not claim missing recorded Focus proves no work, infer an interruption caused the gap, prescribe extra scheduling, choose rollover, or manufacture a persistent history from one week. It asks about explicit protected/recorded evidence, current cycle membership, human intent, or known next-week protection. This grounding review is distinct from the pending user's usefulness evaluation.

## Explicit user evaluation

The comparison contains six unprefilled questions per scenario:

1. Which version helped me make a better Carry/Defer/Drop decision?
2. Did the AI version add anything beyond the deterministic question?
3. Did the AI introduce nuance that the template missed?
4. Did it become more verbose without becoming more useful?
5. Would I notice if the Coach section disappeared?
6. Would I voluntarily read this every week?

The first records A/B/C or “No meaningful difference,” avoiding a forced winner in identical zero-coaching cases. The rest record Yes/No/Unsure/Not applicable, with a notes field for concrete observations. All six scenarios need explicit answers before submission. A final product preference and reason are also required. Nothing is preselected in the evaluation fields; no ratings are generated by a model and no numerical productivity or winner score is computed.

“Save my evaluation” persists only the explicit local research answers to a fresh `user-evaluation-<UUID>.json` in `docs/r5g-evidence`. Same-origin JSON, strict bounded fields, six unique scenarios and the frozen experiment ID are required. Unknown/stale/incomplete submissions fail; earlier submissions are not overwritten. Automated HTTP/browser test responses are written to disposable temporary directories and deleted, not to the human evaluation evidence directory.

| Scenario | User-preferred variant | Chosen C sample | User explanation |
| --- | --- | --- | --- |
| Gap + reflection | Pending | Pending | Pending |
| Following week addressed | Pending | Pending | Pending |
| Repeated finalized Carry | Pending | Pending | Pending |
| Clean week | Pending | Pending | Pending |
| Action completed | Pending | Pending | Pending |
| No permitted reflection | Pending | Pending | Pending |

**Product recommendation: pending explicit user evaluation.** The completed experiment will recommend exactly one of: Keep AI Review coaching; Replace Review AI with deterministic coaching questions; Remove Review coaching entirely and keep only evidence/reflection. This is a qualitative product decision based on the user's scenario answers and reasons, not majority-vote code or an aggregate score. R5G stops after documenting that recommendation; production replacement/removal is not implemented here.

## Verification and artifacts

- Unit tests: **473 passed**, 36 files, retaining all prior R5F tests.
- Dedicated QA browser test: **1 passed**, exercising all six scenarios, identical A/B/C Evidence, accepted/empty/withheld views, explicit evaluation and isolated test storage.
- Typecheck and lint passed. Documentation and final freeze/privacy checks are recorded separately as completed.
- No normal application database access, provider traffic, prompt expansion or larger-model escalation.

[Comparison packet](r5g-evidence/comparison.json) includes exact displayed Evidence, deterministic question and accepted AI sample for every scenario. [Baseline](r5g-evidence/baseline.json) records frozen normal coaching source hashes and zero provider calls. [Three-variant gap screenshot](r5g-evidence/fixtures/gap-three-variants.png) and [repeated-Carry screenshot](r5g-evidence/fixtures/carry-three-variants.png) are controlled browser-test captures, not user preferences.

Limitations: this comparison reuses one live sample per provider/scenario from R5F. It evaluates the actual safety-constrained feature, including withheld output, rather than hypothetical unlocked AI prose. Fixed A/B/C presentation order and a single evaluator do not establish statistical superiority. The deterministic library was reviewed for grounding but its usefulness is not assumed. Identical suppressed/zero cases may legitimately have no preferred variant. Calendar remains frozen as PASS and is not reassessed in this Review experiment.
