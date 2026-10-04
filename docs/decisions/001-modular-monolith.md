# ADR 001 — modular monolith and vertical slices

Status: accepted with review amendments. Date: 2 October 2026.

## Context

One engineer needs a coherent planning loop. Scheduling, focus, and review share ownership and transactional state. Separate services, a full integration platform, and an extensive design system would delay discovery of whether the loop is useful.

## Decision

Use Next.js App Router, React, and TypeScript as a single application, with pure domain functions and application services independent of framework/provider types. A small worker later runs the same modules as a separate process, not a separately owned microservice. Add each feature's database/service/UI/tests together.

Prefer an agenda and accessible forms before a sophisticated calendar interaction. Phase 1 delivers goal CRUD/archive and durable reload behaviour. Complete the manual core loop through Phase 8 before optional integrations.

## Alternatives and consequences

A separate React frontend and API could support independent deployments but adds contracts/operations without an immediate need. Microservices add distributed boundaries around already difficult calendar reconciliation. A backend-first build hides interaction risk until late. A large local-storage prototype would be fast initially but fails the required persistence/ownership foundation.

The monolith needs enforced module boundaries and thin route handlers. Do not let React or Google SDK types absorb business rules. Worker deployment becomes a real operational requirement when sync starts; it is not solved by async callbacks in requests.

## Evidence and revisit trigger

The [official Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation) supports the proposed App Router/TypeScript setup. Exact versions and active Node LTS compatibility are resolved and locked in Phase 0. Revisit service separation only with measured scaling or independently operated capability requirements.

## Phase 0 scope amendment

Implement the current-account shell and auth-only persistence first. No Goal fixture, empty future modules, background-job runtime, event bus, or provider adapter is required. The first ownership boundary has a present consumer: authenticated account context. Phase 1 remains a separate authorised slice.
