# ADR 011 — weekly planning and a small immutable baseline

Status: implemented for the authorized Phase 3A brief. Date: 2 October 2026.

## Decision

Add only WeeklyPlan and WeeklyCommitment. Plan is the versioned aggregate; its lifecycle is Draft → Committed, terminal in Phase 3A. The first committed row set is the original baseline. No revision/event system or amendment persistence exists. This refines ADR 006's baseline intent and supersedes its assumed revision representation for this slice. Amendment representation remains a Phase 3B decision.

Identify weeks by a Monday PostgreSQL date, unique with owner. Derive the current local date using the account's validated IANA timezone and Intl; use calendar-date arithmetic, never a fixed 168-hour interval. Pin the timezone at creation for historical display. Changing account timezone neither rekeys nor duplicates an existing owner/week. New finished-week plans are rejected; existing Drafts remain editable until committed because this brief restricts creation, not historical Draft editing.

Manually enter provisional focus-capable minutes and protected reserve minutes. Usable = capacity − reserve. Sum explicit whole-minute weekly budgets separately from Action estimates. Positive remaining capacity is healthy breathing room. Draft over-capacity is visible and permitted; commitment rejects it without shrinking budgets or reserve. At least one commitment is required. Capacity/budgets are bounded at 10,080 minutes and selection at 50 Actions, keeping the existing 32 KiB command limit practical.

Draft selection records source identity/relationship/version guards. Reuse central Action mutability. A source edit, parent edit or active-Milestone move requires explicit review and saved guards before commitment. Terminal/unavailable work requires deliberate removal. Never rewrite guards on refresh or silently remove commitments.

Commit freezes Action identity/title/done condition/estimate, Goal identity/title/outcome, optional Milestone identity/title/success condition, plus budget and Plan capacity/reserve. Snapshots, state, time, version and receipt are one transaction. Committed reads use those snapshots and do not join source contents. Soft terminal transitions preserve source references. Restrictive owned foreign keys prevent deleting referenced history.

All writes reuse the owner-scoped receipt, then lock Plan → sorted Goals → sorted current Milestones → sorted Actions. Goal locks stabilize associations because existing source writers use Goal → sorted Milestones → Action. Re-read associations after acquiring Goals. Source writers never lock Plans. Full-state saves check expected Plan version and Draft state before aggregate replacement. Stable retained Commitment identities and creation times survive saves; each aggregate replacement is transactional. Commit/commit and save/commit have one winner; matching command retries replay the original result even after later changes.

## Alternatives and consequences

Live joins alone would erase historical meaning. A generic revision engine or event sourcing would decide Phase 3B before using the baseline. Separate tiny budget/selection commands would make version conflicts and user intent harder to compare. Two tables, a full-state Draft command, explicit review and committed snapshots are sufficient now.

Database constraints enforce ownership, owner/week uniqueness, Plan/Action references, duplicate selection, bounds and lifecycle shape. Service/SQL Draft predicates enforce aggregate immutability; privileged direct operator SQL is outside normal product commands. No trigger-based history engine is introduced. Draft source guards deliberately invalidate on any Action/Goal/Milestone version change, including an unrelated parent edit; explicit review is the conservative trade-off.

## Revisit trigger

After real use, propose how amendments can answer “what was originally committed?” and “what changed afterward?” without changing these baseline rows. The Phase 3A report recommends an option for review, not an approved amendment schema.
