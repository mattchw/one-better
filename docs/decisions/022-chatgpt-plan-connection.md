# ADR 022 — owned ChatGPT plan connection, separate from application login

Status: implemented for R5E. Date: 3 October 2026.

## Decision

Better Auth remains the sole application identity/ownership authority. ChatGPT OAuth authorizes optional OpenAI inference, not access to One Better data. An issued client ID and verified OpenAI subject describe an owned registration; identical display emails never merge distinct registrations. One active registration and explicit Use ChatGPT for coaching control credential selection. Existing OpenAI API-key and Anthropic adapters remain available. Failed reconnects, missing permissions or unavailable selected models do not silently fall back to another provider/model.

Use the official local/open-source PKCE flow: stable ignored host-local UUID URN; fresh state, nonce and S256 verifier; initial `dynamic_agent_client` plus `agent_name_hint=One Better`; exact `127.0.0.1` callback; identity, offline and direct-plan/resource scopes. Persist the issued client ID before exchange and reuse it for reconnect/refresh. Validate discovery endpoints, JWKS signature, issuer, issued-client audience, expiry and nonce, then use verified subject. Reconnect must match both saved client ID and subject. Identity without direct-plan permission is connected but inference-disabled. The retained encrypted ID token is not placed in authorization URLs; this avoids hint-bearing URL logging, with account choice followed by subject validation.

Encrypt credential bundles and pending attempts with the existing AES-GCM key ring and owner/registration-specific authenticated data. OAuth transactions are short-lived, owned and consumed once before exchange; abandoned/superseded flows cannot complete. Credentials never enter browser storage or public DTOs. Omit credential-bearing diagnostics and suppress OAuth callback request logs in development. Host configuration persists independently of user records in `.one-better/chatgpt-host.json`, with owner-only file permissions; deleting it is installation replacement, not routine logout.

Use PostgreSQL session advisory locks per owner across processes. This deliberately serializes more than one registration, making rotating refresh and disconnect mutually exclusive. No database transaction stays open across provider network calls; bundle/scopes/version updates are atomic. Near-expiry access refreshes with the saved issued client and latest refresh credential. Terminal refresh errors clear credentials and require sign-in; temporary failures preserve them. Disconnect disables/removes credentials before bounded remote revocation and honestly records whether revocation was confirmed. Application login and plans are unaffected.

Discover models using the connected account catalog. Keep displayable entries in provider order, show display names, persist an explicitly chosen slug and refresh after reconnect/account changes. No fixed model or automatic replacement is assumed. Development Strict Mode shares the in-flight automatic catalog request so the UI cannot expose an immediately outdated version.

## Streaming compatibility and capability boundary

The separate OAuth OpenAI transport implements the same `AIProvider` contract and unchanged R5D prompt/schema/signals/candidates/parser. Public `/v1/responses` requests use `store:false`, `stream:true`, instructions and an array user input. Omit unsupported OAuth request fields, including the API-key adapter's `max_output_tokens`. No tools are supplied.

Success requires `response.completed`. Retain bounded completed output items from the stream: the live plan route can return an empty terminal `output` array. Completed message items without terminal completion still fail. Failed, incomplete, interrupted and admission failures remain distinct at the transport boundary; no partial output reaches the application. JSON parsing, reference/prose validation, fresh deterministic Preview and ordinary human Schedule acceptance remain mandatory. This transport difference grants no new application capability.

Retain available token/cache counts. These represent ChatGPT plan allowance/credits, not an invented dollar API bill. Direct users to ChatGPT usage management; local token counts do not establish credit conversion or billable API spend.

## Verification and limits

Automated tests use local OAuth/JWKS/token/model/Responses fixtures, real PostgreSQL concurrency and actual production stop/start. They require no live login. Finite explicit live QA uses the existing owned connection for inference over disposable frozen R5D scenario facts, without copying rotating credentials or changing personal planning data. [R5E report](../r5e-chatgpt-openai-live-qa.md) records independent Calendar and Review quality verdicts, failed pre-fix attempts and usage. Provider schema compatibility is not a semantic quality guarantee. Do not select a winning provider in code or expand capabilities based on these samples.

Official references: [local token-sharing flow](https://developers.openai.com/siwc/token-sharing-open-source), [sign-in](https://developers.openai.com/siwc/sign-in), [models and inference](https://developers.openai.com/siwc/models-and-inference), [preview limits](https://developers.openai.com/siwc/preview-limitations), [profiles and sessions](https://developers.openai.com/siwc/profiles-and-sessions).
