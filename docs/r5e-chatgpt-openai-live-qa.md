# R5E — ChatGPT Connection + OpenAI Live QA

Observed 3–4 October 2026, Europe/London. Scope: optional ChatGPT connection and comparison against the unchanged R5D contract. **Calendar coaching quality: PASS. Weekly Review coaching quality: FAIL. Review safety: PASS.** Safe, schema-valid Review prose was surfaced, but it was too generic to close the independent usefulness gate. No prompt tuning, new recommendation type, autonomous behavior, AI chat, tool loop, background generation, planning mutation or rollover logic was added.

The connection, streaming compatibility fix, live Calendar/abstention/staleness/acceptance/failure/recovery, real refresh rotation and production restart have been verified. The final user-driven real reconnect was completed and verified on 4 October 2026 while beginning R5F; no OAuth changes were needed. No stronger provider is automatically selected as a winner.

## Connection architecture and configuration

Better Auth remains One Better authentication and the ownership authority. ChatGPT identity never authorizes One Better records. A separate owned registration grants optional OpenAI inference. Additive migration `0014_chatgpt_connection.sql` creates only `chatgpt_connection` and `chatgpt_oauth_flow`; existing planning, recommendation and Review schemas are unchanged. Multiple issued registrations with the same display email remain distinct, with one active registration per owner. Two real registrations were retained without an email-based overwrite.

| Setting | Configuration used, excluding secrets |
| --- | --- |
| Normal local app / callback | `http://127.0.0.1:3100` / `/auth/chatgpt/callback` |
| Host identity | Generated opaque UUID URN in ignored `.one-better/chatgpt-host.json`; file mode 0600, directory created 0700; shared by users of this installation |
| OAuth discovery / issuer | `https://auth.openai.com/.well-known/openid-configuration` / `https://auth.openai.com` |
| Resource / inference | `https://api.openai.com/v1` / public `POST /v1/responses` |
| Requested scopes | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| Credential encryption | Existing server Calendar AES-GCM key ring, with ChatGPT-specific owner/registration authenticated data; optional separate server ring supported |
| OpenAI credentials | Real owned ChatGPT OAuth registration; no OpenAI API key/client secret |
| Exact comparison model | **`gpt-5.6-sol`**, display name **GPT-5.6-Sol**, explicitly selected from the account catalog |
| Compared Haiku model | **`claude-haiku-4-5-20251001`**, existing R5D evidence; no new Haiku request |
| Runtime | Node 24.14.0; Next 16.3.8; OpenAI SDK 7.27.0; JOSE 6.2.12; PostgreSQL 16 |
| Request settings | `store:false`, `stream:true`, same instructions/schema, array user input; no tools; zero SDK retries; SDK 25s / application 30s deadlines |

Registration uses fresh random state, nonce and S256 PKCE verifier/challenge. Initial authorization uses `dynamic_agent_client`, `agent_name_hint=One Better` and the stable host ID. Exact redirect URI is encrypted with the transaction and reused in exchange; neither OAuth host nor callback substitutes `localhost`. Attempts are owned, expire after ten minutes, supersede prior attempts and are consumed once before exchange. Callback validates state before touching the code. Duplicate parameters and foreign-owner/replayed callbacks fail with a clean redirect.

Persist the issued client ID before code exchange, including failed-exchange recovery; never persist the dynamic registration identifier as a registration. Reconnect/refresh reuse the saved issued ID. Reject a changed client ID or verified subject instead of silently changing account. JWKS signature, allowed algorithm, discovery issuer, issued-client audience, expiry and required nonce/sub claims are verified with JOSE. Display email/name come only from validated claims. Direct-plan permission is checked from returned scopes, not inferred from identity. A successful identity without permission is clearly connected but inference-disabled.

Tokens, retained ID token and pending PKCE/nonce/redirect details are encrypted server-side. Public connection DTOs omit credentials and owner fields. No credential browser storage or secret-bearing logs were introduced. The retained ID token is deliberately omitted from authorization URLs, avoiding `id_token_hint` URL exposure; normal account selection plus subject matching remains authoritative.

A final scan of the 18 text evidence artifacts and normal production log found no configured secret values, plaintext access/refresh/ID-token fields, or logged OAuth callback codes. Screenshots were visually checked for credential exposure. This is evidence for this run, not a claim that text scanning proves all future logging safe.

PostgreSQL session advisory locks serialize connection operations per owner across independent processes. This is deliberately stronger than per-registration refresh serialization. No SQL transaction remains open during network exchange/refresh; replacement bundle, scopes and version are saved atomically. Access tokens refresh within two minutes of expiry. Terminal refresh failures clear unusable credentials and require sign-in without retrying a dead token; temporary network/5xx errors retain them. A failing explicitly selected ChatGPT connection never silently substitutes the configured API-key provider.

Disconnect first disables usage and removes protected credentials durably, then performs bounded revocation and reports whether it was confirmed. Non-secret issued-registration/model information remains for reconnect. Better Auth and planning records stay independent. [ADR 022](decisions/022-chatgpt-plan-connection.md) and the [ADR 020 amendment](decisions/020-ai-coaching-proposals.md#r5e-amendment-credential-source-and-streaming-compatibility) record the decision.

## Model discovery and streaming compatibility

The real account catalog returned displayable GPT-6-Astra, GPT-5.6-Sol, GPT-5.6-Terra, GPT-5.6-Luna and GPT-5.5 entries. Only `visibility=list` entries are shown, in provider order; selected slugs are persisted explicitly. Opening Settings refreshes the catalog, not coaching. Reconnect/account changes refresh eligibility; an unavailable saved slug requires explicit reselection. No model substitution is performed.

A browser regression found two automatic model-catalog writes during development Strict Mode, producing a stale version at selection. Sharing the in-flight automatic catalog request fixed this without weakening version checks. The database fixture also needed to select its active registration instead of relying on tied timestamps; the migration schema assertion was updated for the two new tables. A synthetic Google cache was seeded after visiting Integrations so its intentionally unusable Google credential could not invalidate the subsequent Calendar fixture. No product scheduling policy changed.

The OAuth route accepts equivalent `instructions` plus array input and the unchanged strict `text.format` JSON schema. Its transport omits unsupported fields, including the API-key adapter's `max_output_tokens`. R5D prompt SHA-256 remains `1daf28247fe73010eb5e3d5d8743f3921d70f12a0c8789c7b27a85976fbab173`; schema SHA-256 remains `ba4a0d75c79013fcf568170512d23fa8b4e8a054400e35f9ae46690df08d4d83`. Both are asserted against the final R5D artifacts before live calls.

**Real compatibility bug:** the live route supplied completed message items during streaming but sent `output:[]` in the terminal `response.completed` envelope. The initial adapter inspected only that envelope and rejected valid completed output. Three pre-fix Calendar attempts failed safely during transport parsing while returning usage. They are preserved as [first](r5e-evidence/initial-transport-results.json), [second](r5e-evidence/second-transport-results.json) and [terminal-envelope diagnostic](r5e-evidence/third-transport-results.json), rather than discarded as successful recommendations.

The smallest transport fix retains bounded `response.output_item.done` items, orders them by output index, and reads them only after terminal completion when the terminal output is empty. A completed item without `response.completed` still fails. Failed, incomplete, interrupted and pre-stream admission failures remain distinct transport outcomes. Partial/delta text never becomes an actionable recommendation. Refusal, JSON shape, identifiers, qualitative prose, count, candidate membership and fresh deterministic placement still pass through the same R5D checks. Regression tests cover empty terminal output and interruption after a completed item. No prompt/schema/validator tuning accompanied the fix.

## Frozen scenarios and isolation

Use **unchanged `tests/r5c-scenario.ts`**, the same final R5C/R5D clean-restraint variant. New disposable row UUIDs differ between runs, while titles, dates, budgets, recorded execution, availability, reflection text and signal/candidate policy remain the same. Request time is frozen at **5 January 2028, 08:00 UTC**; timezone Europe/London; Calendar week 3–9 January and historical Review week 27 December–2 January. See [scenario and exact packets](r5e-evidence/scenario.json).

- Active Focus Cycle: “Make the weekly loop useful and sustainable,” 20 December–31 January, with beta/onboarding, sustainable running and practical essay Goals selected.
- Committed current plan: onboarding 240m budget / 45m scheduled / 30m recorded; run 60m budget / scheduled / recorded; essay 60m budget / scheduled, future block. Capacity 720m, protected reserve 180m, usable 540m, total budget 360m. Estimates and completion state remain separate.
- Focusable windows: weekdays 09:00–12:00 and 14:00–16:00. Fresh synthetic FreeBusy excludes Wednesday 10:00–11:00, Thursday 09:00–10:00 and Friday 14:00–15:00. Local TimeBlocks are subtracted. Candidates must be future and deterministic Preview-legal.
- Prior finalized Review: onboarding 120m budget / 60m scheduled / 30m recorded, with a human Carry decision proposing 90m. The older review is draft. One prior Carry is not labeled repeated Carry.
- Well-planned account: three 60m budgets fully scheduled, recorded completed Focus for onboarding/run and future essay time; no justified decision signal or scheduling candidate. Desired output is exactly zero recommendations.
- Review: permitted finalized daily/weekly text, with separate sentinels for drafts, late finalization, session notes and Google metadata.

The finite server-side QA harness used the **existing owned real registration only as its credential source**; rotating credentials were never copied into the disposable scenario database. No personal Goal/plan/reflection content was transmitted. All scheduling mutations and UI acceptance used disposable accounts/databases. Production restart checks and the source disconnect compared only non-secret hashes/booleans in evidence. QA databases were removed afterward.

The optional UI inspector on port 3105 rendered the real saved OAuth runs and used the same deterministic Preview/editor. It held no OAuth credentials and was configured with a dummy API-key provider only for panel reads; its generation button was not used. The finite harness performed every live request through the OAuth adapter. Browser screenshots therefore show real saved output, not a fake provider. The real connection itself was verified in the normal port-3100 app.

## Live results, usage and failures

Ten explicit OpenAI requests were made: three failed pre-fix compatibility investigations; the five comparison cells; one real rotating-refresh recovery cell; and a repeated invalid-credential admission failure for its screenshot. There was no automatic model repair, provider retry or comparison prompt change. Two invalid credentials were deliberate synthetic Bearer values and did not revoke or corrupt the real credential.

| Cell | Latency | Input / output / cached tokens | Accepted recommendations | Result |
| --- | ---: | ---: | ---: | --- |
| Pre-fix Calendar 1 | 5,249ms | 3,004 / 142 / 0 | 0 | Completed stream; envelope-only parser withheld output |
| Pre-fix Calendar 2 | 6,025ms | 3,043 / 147 / 0 | 0 | Same safe transport rejection |
| Pre-fix terminal diagnostic | 6,267ms | 3,063 / 149 / 0 | 0 | Verified completed status with empty terminal output |
| Calendar after fix | 5,503ms | 3,069 / 151 / 0 | 1 | Schema/reference/prose checks pass; legal Preview |
| Well-planned week | 2,217ms | 2,346 / 16 / 0 | **0** | Successful abstention, no filler |
| Finalized Weekly Review | 10,794ms | 2,223 / 362 / 0 | 1 | Safe/accepted; human usefulness gate remains failed |
| Regenerate after ordinary block creation | 5,736ms | 3,071 / 151 / 0 | 1 | Current facts, legal Preview, explicit UI acceptance |
| Deliberate admission failure | 441ms | unavailable | 0 | Sanitized authentication failure; core planning/Preview usable |
| Recovery with real refresh rotation | 9,071ms | 3,061 / 151 / 0 | 1 | Replacement refresh persisted; current new candidate legal |
| Repeated admission failure screenshot | 289ms | unavailable | 0 | Same sanitized failure, valid connection unchanged |

[Comparison results](r5e-evidence/results.json) retain raw structured output, application acceptance, context fingerprints, checked placements and usage. [Recovery/refresh](r5e-evidence/recovery-refresh.json) and [screenshot failure](r5e-evidence/failure-screenshot-run.json) retain the explicit follow-ups. The terminal-envelope diagnostic also preserves its provider usage attribution. The ordinary saved run retains available input/output/cache counts; no credit conversion was supplied.

These requests consumed **ChatGPT plan allowance/credits**, not an asserted API-key dollar bill. No dollar API cost was inferred from token counts. Use [ChatGPT usage management](https://chatgpt.com/settings/usage) for account limits/credits. The Haiku API-key estimates in its historical report are a different billing mechanism and are not applied to OpenAI OAuth.

After the compatibility fix, all completed comparison/recovery outputs satisfied the application schema, used supplied references and stayed under the three-recommendation limit. No fabricated reference survived validation. There were no post-fix shape/reference/prose validation failures in these samples. Automated fabricated-ID, unsupported-field/type and incomplete/interrupted-output cases still fail closed. Schema acceptance alone does not close the human quality gate.

## Human quality review of every surfaced recommendation

| Recommendation | Grounding and evidence | Usefulness / specificity / actionability | Restraint and weakness |
| --- | --- | --- | --- |
| Calendar: onboarding, Wednesday 09:00–10:00 | Exact supplied candidate and commitment/Goal refs; server Evidence shows 240m budget, 45m scheduled, 195m unscheduled, 30m recorded and fresh legal slot. No invented factual statement. | Materially helps place deliberately committed work. Goal/week/time specificity comes from the selected deterministic candidate. Preview gives a clear next step. | One 60m block, not every available hour. Rationale is safe but generic: “Protecting a manageable block…” adds little personalized explanation. Calendar quality passes on the useful grounded proposal. |
| Weekly Review: revisit practical essay Focus Goal | References the supplied focus-without-commitment signal and selected Goal. No invented historical quantity, causality or AI rollover decision. Displayed Evidence says only that the current Focus includes this Goal. | **Too weak to close Review quality.** “Revisit whether this focus area merits deliberate attention…” is transferable boilerplate. It does not interpret the significant onboarding execution difference or permitted interruption reflection, or explain why essay deserves attention over the other uncommitted Focus Goal. The fixture's following week already protects essay time; a broad next-plan nudge adds limited value. | One optional navigation, no invented work or Carry/Defer/Drop decision. Safety passes. Evidence alignment is thin: Goal presence alone does not explain the historical commitment gap. No new Review signal/evidence logic was added to hide this limitation. |
| Regenerated Calendar: onboarding, Wednesday 09:00–10:00 | Fresh Evidence shows 105m scheduled / 135m unscheduled. Same still-free slot remains legal; fingerprint and review digest are new. | Useful current proposal with clear ordinary Schedule acceptance. The same slot ID is expected because its owned interval remains free; advice freshness comes from current facts, not random new IDs. | One bounded block; rationale repeats the initial sentence. No planning/execution/reflective facts invented. |
| Recovery Calendar: onboarding, Wednesday 11:00–12:00 | Newly current candidate avoids the accepted 09:00 block and busy 10:00 interval; 165m scheduled / 75m unscheduled, 60m proposal. | Useful legal next block, new candidate ID, clear Preview. Uses current facts after acceptance and refresh, not the old placement. | Leaves remaining budget and breathing room; repeats the generic safe rationale. No automatic acceptance occurred. |

No recommendations existed in the restrained or failure cells, and pre-fix outputs were never surfaced. No numerical productivity score or provider winner score was created. The human quality judgment above is stricter than mechanical validation.

## OpenAI versus existing Haiku evidence

| Dimension | GPT-5.6-Sol through ChatGPT | Haiku 4.5, existing final R5D QA |
| --- | --- | --- |
| Grounding / scheduling | Supplied legal candidate accepted and explicitly scheduled. | Supplied legal candidate accepted and explicitly scheduled. |
| Calendar explanation | Short, restrained but largely reusable wording. | More explicit connection to onboarding, essay/recovery and beta Focus intent. |
| Abstention | Zero on clean fully planned state. | Zero on equivalent state. |
| Review safety | One qualitative response accepted; no unsupported history/quantity or rollover decision observed. | Two raw Review recommendations violated prose restrictions and were withheld. |
| Review usefulness | Accepted but generic; independent human quality gate **FAIL**. | No usable surfaced Review output; quality **FAIL**, safety **PASS**. |
| Latency | Calendar 5.50s; restraint 2.22s; Review 10.79s; regeneration 5.74s. | Calendar 6.47s; restraint 1.46s; Review 4.56s; corrective regeneration 6.64s. |
| Usage / billing | Available token counts; plan allowance/credits, no invented dollar bill. | Input/output counts and approximate API-key text costs recorded historically. |

These are observations from small samples, not statistically reliable model rankings. OpenAI solved the observed transport problem and avoided Haiku's Review prose violation, but validity did not produce a sufficiently useful Review insight. The configured server provider was not automatically changed based on this comparison; ChatGPT use/model selection is an explicit owned setting. See [R5D report](r5d-ai-quality-hardening-report.md) and its [follow-up](r5d-evidence/regenerate-followup.json).

## Privacy, staleness and acceptance

Every actual Calendar packet was checked against all reflection/session/Google exclusion sentinels. None appeared. Explicit Review contained only the permitted finalized daily and weekly bodies; draft daily/weekly text, daily text finalized after the Review cutoff, session notes and Google account/calendar metadata were absent. Generation hashes proved no upstream mutation. No Carry/Defer/Drop command, Action completion, new Action or new Focus Cycle was produced.

The staleness test created a normal Thursday 10:00–11:00 TimeBlock. Original advice became stale and its server Preview rejected with `COACHING_STALE`; the UI disabled Preview. Regeneration used the changed 105m scheduled / 135m unscheduled packet. Its still-free Wednesday candidate retained a stable ID, but the updated fingerprint, evidence and deterministic review were required. This does not permit applying an old run. After explicit ordinary UI Schedule acceptance, scheduled onboarding became 165m and unscheduled 75m; regenerated advice became stale again.

[UI acceptance audit](r5e-evidence/ui-acceptance.json) verifies Goal/Action/plan/amendment/execution/reflection/Focus Cycle/availability rows stayed byte unchanged: only the new TimeBlock and ordinary mutation receipt changed. Recovery later produced a new Wednesday 11:00 candidate after subtracting the accepted block and busy interval. No AI apply endpoint was added.

## Restart, refresh, disconnect and reconnect

[Real production restart](r5e-evidence/real-restart.json) preserved the registration, encrypted bundle, selected model and explicit provider setting without OAuth. Live regeneration/recovery then used that existing credential. [Real rotating refresh](r5e-evidence/recovery-refresh.json) simulated **only saved access-expiry metadata**; OpenAI itself refreshed once, returned a changed replacement refresh token, and the owner-locked service saved it atomically. Model selection remained unchanged and live coaching succeeded. No plaintext token or hash identifying a token is included in the evidence.

The automated production proof independently stops/starts processes, verifies expired access refresh once, persists the replacement through another restart, performs coaching without reauthorization, persists disconnect through restart and reconnects with the saved issued client/model/host ID. It uses only fake OAuth/JWKS/token/model/Responses endpoints against its disposable PostgreSQL database.

[Real disconnect](r5e-evidence/real-disconnect.json) removed credentials before revocation; OpenAI's revocation endpoint confirmed success. Core personal planning and Better Auth account/session rows remained byte unchanged. The same owned service powers the tested UI endpoint. Reconnect deliberately requires the user's OpenAI login/consent and the saved registration, rather than a new dynamic registration.

**Final real reconnect: PASS.** [Verification](r5e-evidence/real-reconnect.json) confirms the same owned registration, issued client ID, validated subject, host ID and GPT-5.6-Sol model. The refreshed catalog includes that model, encrypted credentials are present and plan permission is granted. The user completed login/consent; the explicit coaching toggle was then enabled through the ordinary UI. [Screenshot](r5e-evidence/screenshots/reconnected.jpg). The local app was restarted at port 3100 after its prior process ended. The browser QA accounts were separate disposable One Better users; switching local QA sessions in the shared 127.0.0.1 browser requires returning to the normal workspace's application sign-in, without deleting its server session records.

## Automated verification and screenshots

- Documentation links/fences, lint, TypeScript and production build: **passed**. The final production build is running at port 3100.
- Unit: **450 passed**, 32 files, including 18 ChatGPT transport/security regressions.
- PostgreSQL: **300 passed**, 15 files; independent service/pool refresh concurrency, ownership, one-time state, missing permission, model selection, same-email registrations, encrypted persistence, terminal/temporary failures and disconnect/reconnect.
- Browser: **148 passed**, including four full fake ChatGPT OAuth/model/coaching/Preview/stale/disconnect/mobile and HTTP-boundary cases. All R5D browser cases remain passing.
- Production restart: **all eight proofs passed**, including the new ChatGPT proof and existing app/Calendar/planning/execution/Review/coaching proofs.
- Normal suites require no live OpenAI credentials. No live-provider dependency was added to `npm run check`.

| Screenshot | What it shows |
| --- | --- |
| [Real connected account](r5e-evidence/screenshots/chatgpt-connected.jpg) | Actual permission, catalog selection and explicit ChatGPT usage; no tokens. |
| [OpenAI Calendar](r5e-evidence/screenshots/openai-calendar.jpg) | One real saved scheduling proposal. |
| [Why Evidence / Coach](r5e-evidence/screenshots/why-evidence.jpg) | Server factual quantities/slot separated from qualitative prose. |
| [Initial Preview](r5e-evidence/screenshots/scheduling-preview.jpg) | Future legal slot, inside Focusable Hours, fresh coverage and no busy overlap. |
| [Zero recommendations](r5e-evidence/screenshots/abstention.jpg) | Fully planned state and calm successful abstention. |
| [Weekly Review](r5e-evidence/screenshots/weekly-review-coaching.jpg) | Scrolled Review Coach prose and thin Goal-only evidence; no fake successful insight. |
| [Stale advice](r5e-evidence/screenshots/stale-advice.jpg) | Changed facts and disabled Preview. |
| [Regenerated evidence](r5e-evidence/screenshots/regenerated-advice.jpg) | Updated unscheduled budget. |
| [Regenerated Preview](r5e-evidence/screenshots/regenerated-preview.jpg) | Current deterministic review before explicit acceptance. |
| [Provider failure](r5e-evidence/screenshots/provider-failure.jpg) | Real repeated admission failure, usable Calendar and accepted local block. |

The `fixtures/` screenshots are automated fake-provider evidence and are explicitly separate from these real saved-output screenshots. The existing Haiku screenshots remain linked from the R5D report; they were not rerun or relabeled.

## Remaining limitations and proposed next phase

Weekly Review usefulness remains unresolved despite safe output. A stricter lexical guard still cannot prove all qualitative implications and can reject useful prose; it was not weakened here. The single Review recommendation is not evidence that the model meaningfully used the finalized reflection. Broader sampling and better explanation of deterministic Review evidence are needed before claiming a useful coaching loop.

This is a local/open-source preview flow, not a cloud OAuth rollout. Account eligibility/catalogs/plan limits can change. Host configuration and encryption keys must be preserved; loss requires recovery/reconnection. A provider-success/database-save crash between refresh and persistence cannot be made atomically consistent across OpenAI and PostgreSQL; a lost rotating credential may require sign-in. Advisory locks serialize the whole owner's connection operations and hold a pool connection during bounded network work. Additional account-switch edge cases remain worth field testing.

OAuth rejects a provider output-token cap; local output-size limits and deadlines do not establish a precise plan-credit spending limit. Only available token/cache counts are retained in normal run usage. Stream/5xx/model failure branches have deterministic fake coverage; live failure was a safe admission-authentication error. No private backend endpoint, manual token harvesting or unofficial session reuse was used.

The candidate policy and two-read context consistency limits remain those documented in R5D. Earliest bounded slots are not an energy/deadline optimizer; current facts can change after reads, so ordinary acceptance guards remain essential. The QA inspector is a finite development tool, not an application feature or background generator.

**Next phase proposal only: R5F — Weekly Review usefulness and evidence quality gate.** Evaluate explicit Review insights over frozen examples and improve only the human-readable grounding/usefulness contract with reviewed acceptance criteria. Keep current safety, user decisions and deterministic mutation boundaries. Do not start general chat, agents or automatic scheduling. No R5F work has been implemented.
