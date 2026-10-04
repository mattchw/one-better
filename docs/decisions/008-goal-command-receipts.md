# ADR 008 — atomic Goal command receipts

Status: accepted implementation refinement. Date: 2 October 2026.

## Decision

Use one small MutationReceipt table for Goal create/edit/archive. Its primary key is (owner_id, mutation_id), tightening the earlier user/command/id namespace: reusing an ID for another command or payload is rejected. The hash covers command type, resource ID, expected version, and normalized fields. The actor supplies the owner. The request carries a UUID mutation ID.

In one Postgres transaction insert a receipt claim with ON CONFLICT DO NOTHING, lock/read that owner-scoped receipt, replay a matching completed result, or perform the owned Goal mutation and store its successful DTO snapshot. A concurrent duplicate waits for the original transaction; rollback removes the claim and mutation together. Failed validation/not-found/conflict commands leave no receipt. Row locks plus owner/ID/expected-version predicates serialize updates without lost writes. Receipt replay precedes current-version checks so successful retries cannot conflict artificially.

Store the original response snapshot rather than just the ID/version: later edits or archive cannot change the result returned for an earlier successful command. Replay reports that original result; UI reloads the current list after acknowledgement. Private reads and mutations are never cached globally. Retain receipts indefinitely in this local slice, with no automatic cleanup: pruning would limit the retry guarantee. Before hosted growth/account erasure, specify an explicit retention window and erasure policy. No job, workflow, event-sourcing, or general command framework is introduced.

## Product refinement

The Phase 1 brief explicitly excludes dates. Goal contains required title/outcome, nullable archive instant, optimistic version, and creation/update instants only. Archived goals are readable and immutable; no restore or hard-delete command.

## Evidence

Real Postgres tests will cover simultaneous duplicates, different payload/key reuse, rollback, original-result replay after later changes, distinct owner namespaces, competing edits/archive, and retained rows. Browser tests will cover an acknowledgement lost after commit and preserved conflict drafts. Measured results belong in the Phase 1 report.
