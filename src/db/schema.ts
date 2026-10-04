import type { CheckedRecommendation, Failure, Usage } from '../modules/coaching/domain';
import type { CycleGoal, CycleStatus, FocusCycle } from '../modules/focus-cycles/domain';
import type { WeeklyReview } from "../modules/weekly-reviews/domain";
import type { FocusSession } from "../modules/focus/domain";
import type { DailyReflection } from "../modules/reviews/domain";
import type { FocusableHoursSchedule, FocusableWindow } from "../modules/availability/domain";
import type { TimeBlock } from "../modules/scheduling/domain";
import { relations, sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Amendment } from "../modules/amendments/domain";
import type { WeeklyPlan, SourceGuard, PlanningSnapshot } from "../modules/planning/domain";
import type { Action } from "../modules/actions/domain";
import type { Milestone } from "../modules/milestones/domain";
import type { Goal } from "../modules/goals/domain";
import type { BusyInterval, Calendar, CalendarFailure, ConnectionState } from "../modules/calendar/domain";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable("app_user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  timezone: text("timezone").notNull().default("Europe/London"),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const aiRecommendationRun = pgTable('ai_recommendation_run', {
  ownerId:text('owner_id').notNull().references(()=>user.id,{onDelete:'restrict'}),id:uuid('id').notNull(),
  contextType:text('context_type').$type<'calendar'|'weekly_review'>().notNull(),week:date('week').notNull(),
  fingerprint:text('fingerprint').notNull(),requestHash:text('request_hash').notNull(),provider:text('provider').$type<'openai'|'anthropic'>().notNull(),model:text('model').notNull(),
  generatedAt:instant('generated_at').notNull(),createdAt:instant('created_at').notNull().defaultNow(),
  status:text('status').$type<'pending'|'succeeded'|'failed'>().notNull(),
  recommendations:jsonb('recommendations').$type<CheckedRecommendation[]>().notNull(),failure:text('failure').$type<Failure>(),usage:jsonb('usage').$type<Usage>(),latencyMs:integer('latency_ms'),
},t=>[
  primaryKey({columns:[t.ownerId,t.id]}),index('coaching_owned_scope_created_idx').on(t.ownerId,t.contextType,t.week,t.createdAt),
  check('coaching_hashes',sql`char_length(${t.fingerprint})=64 AND char_length(${t.requestHash})=64`),
  check('coaching_context',sql`${t.contextType} IN ('calendar','weekly_review') AND extract(isodow FROM ${t.week})=1`),
  check('coaching_provider',sql`${t.provider} IN ('openai','anthropic') AND char_length(${t.model}) BETWEEN 1 AND 160`),
  check('coaching_result',sql`jsonb_typeof(${t.recommendations})='array' AND jsonb_array_length(${t.recommendations})<=3 AND octet_length(${t.recommendations}::text)<=64000`),
  check('coaching_state',sql`(${t.status}='pending' AND ${t.failure} IS NULL AND ${t.latencyMs} IS NULL AND ${t.usage} IS NULL AND ${t.recommendations}='[]'::jsonb) OR (${t.status}='succeeded' AND ${t.failure} IS NULL AND ${t.latencyMs} IS NOT NULL AND ${t.latencyMs}>=0) OR (${t.status}='failed' AND ${t.failure} IS NOT NULL AND ${t.recommendations}='[]'::jsonb AND ${t.failure} IN ('timeout','authentication','rate_limit','model_unavailable','unavailable','invalid_output','refusal','context_too_large') AND ${t.latencyMs} IS NOT NULL AND ${t.latencyMs}>=0)`),
]);
export const session = pgTable("auth_session", {
  id: text("id").primaryKey(), expiresAt: instant("expires_at").notNull(), token: text("token").notNull().unique(),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("auth_session_owner_idx").on(t.userId)]);
export const account = pgTable("auth_account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: instant("access_token_expires_at"), refreshTokenExpiresAt: instant("refresh_token_expires_at"),
  scope: text("scope"), password: text("password"),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, (t) => [index("auth_account_owner_idx").on(t.userId), uniqueIndex("auth_account_provider_identity_idx").on(t.providerId, t.accountId)]);
export const verification = pgTable("auth_verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, (t) => [index("auth_verification_identifier_idx").on(t.identifier)]);

export const userRelations = relations(user, ({ many }) => ({ sessions: many(session), accounts: many(account) }));
export const sessionRelations = relations(session, ({ one }) => ({ user: one(user, { fields: [session.userId], references: [user.id] }) }));
export const accountRelations = relations(account, ({ one }) => ({ user: one(user, { fields: [account.userId], references: [user.id] }) }));

export const goal = pgTable("goal", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  title: text("title").notNull(), outcome: text("outcome").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
  archivedAt: instant("archived_at"),
}, (t) => [
  index("goal_owner_archive_created_idx").on(t.ownerId, t.archivedAt, t.createdAt, t.id),
  uniqueIndex("goal_owner_identity_idx").on(t.ownerId, t.id),
  check("goal_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 160 AND char_length(btrim(${t.title})) > 0`),
  check("goal_outcome_length", sql`char_length(${t.outcome}) BETWEEN 1 AND 2000 AND char_length(btrim(${t.outcome})) > 0`),
  check("goal_positive_version", sql`${t.version} > 0`),
  check("goal_archive_time", sql`${t.archivedAt} IS NULL OR ${t.archivedAt} >= ${t.createdAt}`),
]);
export const mutationReceipt = pgTable("mutation_receipt", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  mutationId: uuid("mutation_id").notNull(), requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<FocusCycle | Goal | Milestone | Action | WeeklyPlan | Amendment | FocusableHoursSchedule | TimeBlock | FocusSession | DailyReflection | WeeklyReview>(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.mutationId] }), check("receipt_hash_length", sql`char_length(${t.requestHash}) = 64`)]);

export const milestone = pgTable("milestone", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), goalId: uuid("goal_id").notNull(),
  title: text("title").notNull(), successCondition: text("success_condition").notNull(),
  state: text("state").$type<"active" | "completed" | "archived">().notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
  completedAt: instant("completed_at"), archivedAt: instant("archived_at"), evidence: text("evidence"),
}, (t) => [
  foreignKey({ columns: [t.ownerId, t.goalId], foreignColumns: [goal.ownerId, goal.id], name: "milestone_owned_goal_fk" }).onDelete("restrict"),
  uniqueIndex("milestone_owner_goal_identity_idx").on(t.ownerId, t.goalId, t.id),
  index("milestone_owner_goal_state_created_idx").on(t.ownerId, t.goalId, t.state, t.createdAt, t.id),
  check("milestone_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 160 AND char_length(btrim(${t.title})) > 0`),
  check("milestone_condition_length", sql`char_length(${t.successCondition}) BETWEEN 1 AND 2000 AND char_length(btrim(${t.successCondition})) > 0`),
  check("milestone_evidence_length", sql`${t.evidence} IS NULL OR char_length(${t.evidence}) BETWEEN 1 AND 2000`),
  check("milestone_positive_version", sql`${t.version} > 0`),
  check("milestone_lifecycle", sql`(${t.state} = 'active' AND ${t.completedAt} IS NULL AND ${t.archivedAt} IS NULL AND ${t.evidence} IS NULL) OR (${t.state} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.archivedAt} IS NULL) OR (${t.state} = 'archived' AND ${t.archivedAt} IS NOT NULL AND ${t.completedAt} IS NULL AND ${t.evidence} IS NULL)`),
  check("milestone_terminal_time", sql`(${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.createdAt}) AND (${t.archivedAt} IS NULL OR ${t.archivedAt} >= ${t.createdAt})`),
]);

export const action = pgTable("action", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), goalId: uuid("goal_id").notNull(), milestoneId: uuid("milestone_id"),
  title: text("title").notNull(), doneWhen: text("done_when"), estimateMinutes: integer("estimate_minutes"),
  state: text("state").$type<"open" | "completed" | "archived">().notNull().default("open"), version: integer("version").notNull().default(1),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
  completedAt: instant("completed_at"), archivedAt: instant("archived_at"),
}, (t) => [
  foreignKey({ columns: [t.ownerId, t.goalId], foreignColumns: [goal.ownerId, goal.id], name: "action_owned_goal_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.goalId, t.milestoneId], foreignColumns: [milestone.ownerId, milestone.goalId, milestone.id], name: "action_owned_milestone_fk" }).onDelete("restrict"),
  uniqueIndex("action_owner_identity_idx").on(t.ownerId, t.id),
  index("action_owner_goal_state_created_idx").on(t.ownerId, t.goalId, t.state, t.createdAt, t.id),
  check("action_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 160 AND char_length(btrim(${t.title})) > 0`),
  check("action_done_when_length", sql`${t.doneWhen} IS NULL OR char_length(${t.doneWhen}) BETWEEN 1 AND 2000`),
  check("action_estimate_bounds", sql`${t.estimateMinutes} IS NULL OR ${t.estimateMinutes} BETWEEN 1 AND 10080`),
  check("action_positive_version", sql`${t.version} > 0`),
  check("action_lifecycle", sql`(${t.state} = 'open' AND ${t.completedAt} IS NULL AND ${t.archivedAt} IS NULL) OR (${t.state} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.archivedAt} IS NULL) OR (${t.state} = 'archived' AND ${t.archivedAt} IS NOT NULL AND ${t.completedAt} IS NULL)`),
  check("action_terminal_time", sql`(${t.completedAt} IS NULL OR ${t.completedAt} >= ${t.createdAt}) AND (${t.archivedAt} IS NULL OR ${t.archivedAt} >= ${t.createdAt})`),
]);

export const weeklyPlan = pgTable("weekly_plan", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  weekStartDate: date("week_start_date", { mode: "string" }).notNull(), timezone: text("timezone").notNull(),
  state: text("state").$type<"draft" | "committed">().notNull().default("draft"),
  provisionalCapacityMinutes: integer("provisional_capacity_minutes").notNull(), reserveMinutes: integer("reserve_minutes").notNull(),
  version: integer("version").notNull().default(1), createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(), committedAt: instant("committed_at"),
}, (t) => [
  uniqueIndex("weekly_plan_owner_week_idx").on(t.ownerId, t.weekStartDate),
  uniqueIndex("weekly_plan_owner_identity_idx").on(t.ownerId, t.id),
  check("weekly_plan_monday", sql`extract(isodow from ${t.weekStartDate}) = 1 AND ${t.weekStartDate} BETWEEN '2000-01-01'::date AND '9999-12-31'::date`),
  check("weekly_plan_capacity", sql`${t.provisionalCapacityMinutes} BETWEEN 1 AND 10080 AND ${t.reserveMinutes} >= 0 AND ${t.reserveMinutes} < ${t.provisionalCapacityMinutes}`),
  check("weekly_plan_version", sql`${t.version} > 0`),
  check("weekly_plan_lifecycle", sql`(${t.state} = 'draft' AND ${t.committedAt} IS NULL) OR (${t.state} = 'committed' AND ${t.committedAt} IS NOT NULL AND ${t.committedAt} >= ${t.createdAt})`),
]);
export const weeklyCommitment = pgTable("weekly_commitment", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), planId: uuid("plan_id").notNull(), actionId: uuid("action_id").notNull(),
  budgetMinutes: integer("budget_minutes").notNull(), source: jsonb("source_guard").$type<SourceGuard>().notNull(), snapshot: jsonb("snapshot").$type<PlanningSnapshot>(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, (t) => [
  foreignKey({ columns: [t.ownerId, t.planId], foreignColumns: [weeklyPlan.ownerId, weeklyPlan.id], name: "commitment_owned_plan_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.actionId], foreignColumns: [action.ownerId, action.id], name: "commitment_owned_action_fk" }).onDelete("restrict"),
  uniqueIndex("weekly_commitment_plan_action_idx").on(t.ownerId, t.planId, t.actionId),
  check("weekly_commitment_budget", sql`${t.budgetMinutes} BETWEEN 1 AND 10080`),
  check("weekly_commitment_source", sql`jsonb_typeof(${t.source}) = 'object' AND ${t.source} ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion']`),
  check("weekly_commitment_snapshot", sql`${t.snapshot} IS NULL OR (jsonb_typeof(${t.snapshot}) = 'object' AND ${t.snapshot} ?& ARRAY['action','goal','milestone'] AND ${t.snapshot}->'action'->>'id' = ${t.actionId}::text)`),
]);

export const weeklyPlanAmendment = pgTable("weekly_plan_amendment", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), planId: uuid("plan_id").notNull(),
  sequenceNumber: integer("sequence_number").notNull(), reason: text("reason").notNull(), version: integer("version").notNull(),
  provisionalCapacityMinutes: integer("provisional_capacity_minutes").notNull(), reserveMinutes: integer("reserve_minutes").notNull(), createdAt: instant("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.ownerId, t.planId], foreignColumns: [weeklyPlan.ownerId, weeklyPlan.id], name: "amendment_owned_plan_fk" }).onDelete("restrict"),
  uniqueIndex("amendment_plan_sequence_idx").on(t.planId, t.sequenceNumber),
  uniqueIndex("amendment_owner_identity_idx").on(t.ownerId, t.id),
  check("amendment_sequence_version", sql`${t.sequenceNumber} > 0 AND ${t.version} > 1`),
  check("amendment_reason", sql`char_length(${t.reason}) BETWEEN 1 AND 500 AND char_length(btrim(${t.reason})) > 0`),
  check("amendment_capacity", sql`(${t.provisionalCapacityMinutes} BETWEEN 1 AND 10080 AND ${t.reserveMinutes} >= 0 AND ${t.reserveMinutes} < ${t.provisionalCapacityMinutes}) OR (${t.provisionalCapacityMinutes} = 0 AND ${t.reserveMinutes} = 0)`),
]);
export const amendmentCommitment = pgTable("amendment_commitment", {
  amendmentId: uuid("amendment_id").notNull(), id: uuid("id").notNull(), ownerId: text("owner_id").notNull(), actionId: uuid("action_id").notNull(),
  budgetMinutes: integer("budget_minutes").notNull(), source: jsonb("source_guard").$type<SourceGuard>().notNull(), snapshot: jsonb("snapshot").$type<PlanningSnapshot>().notNull(),
}, t => [
  primaryKey({ columns: [t.amendmentId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.amendmentId], foreignColumns: [weeklyPlanAmendment.ownerId, weeklyPlanAmendment.id], name: "amendment_commitment_owned_amendment_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.actionId], foreignColumns: [action.ownerId, action.id], name: "amendment_commitment_owned_action_fk" }).onDelete("restrict"),
  uniqueIndex("amendment_commitment_action_idx").on(t.amendmentId, t.actionId),
  check("amendment_commitment_budget", sql`${t.budgetMinutes} BETWEEN 1 AND 10080`),
  check("amendment_commitment_source", sql`jsonb_typeof(${t.source}) = 'object' AND ${t.source} ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion']`),
  check("amendment_commitment_snapshot", sql`jsonb_typeof(${t.snapshot}) = 'object' AND ${t.snapshot} ?& ARRAY['action','goal','milestone'] AND (${t.snapshot}->'action'->>'id') IS NOT NULL AND ${t.snapshot}->'action'->>'id' = ${t.actionId}::text`),
]);

export const calendarConnection = pgTable("google_calendar_connection", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  state: text("state").$type<ConnectionState>().notNull(), version: integer("version").notNull(),
  providerAccountId: text("provider_account_id"), encryptedCredentials: text("encrypted_credentials"),
  accessExpiresAt: instant("access_expires_at"), grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull(),
  calendars: jsonb("calendars").$type<Calendar[]>().notNull(), selectedCalendarIds: jsonb("selected_calendar_ids").$type<string[]>().notNull(),
  listFetchedAt: instant("list_fetched_at"), listError: text("list_error").$type<CalendarFailure>(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  uniqueIndex("calendar_connection_owner_idx").on(t.ownerId), uniqueIndex("calendar_connection_owner_identity_idx").on(t.ownerId, t.id),
  check("calendar_connection_version", sql`${t.version} > 0`),
  check("calendar_connection_lifecycle", sql`(${t.state} = 'connected' AND ${t.encryptedCredentials} IS NOT NULL AND ${t.accessExpiresAt} IS NOT NULL) OR (${t.state} = 'reauthorization_required') OR (${t.state} = 'disconnected' AND ${t.encryptedCredentials} IS NULL AND ${t.accessExpiresAt} IS NULL AND ${t.selectedCalendarIds} = '[]'::jsonb AND ${t.calendars} = '[]'::jsonb AND ${t.grantedScopes} = '[]'::jsonb AND ${t.providerAccountId} IS NULL)`),
  check("calendar_connection_arrays", sql`jsonb_typeof(${t.calendars}) = 'array' AND jsonb_typeof(${t.selectedCalendarIds}) = 'array' AND jsonb_array_length(${t.selectedCalendarIds}) <= 50 AND jsonb_typeof(${t.grantedScopes}) = 'array'`),
]);
export const calendarOAuthFlow = pgTable("calendar_oauth_flow", {
  ownerId: text("owner_id").primaryKey().references(() => user.id, { onDelete: "restrict" }),
  stateHash: text("state_hash").notNull().unique(), encryptedVerifier: text("encrypted_verifier"), expiresAt: instant("expires_at").notNull(),
  result: text("result").$type<"processing" | "success" | "cancelled" | "failed">(),
}, t => [check("calendar_oauth_hash", sql`char_length(${t.stateHash}) = 64`), check("calendar_oauth_secret", sql`(${t.result} IS NULL AND ${t.encryptedVerifier} IS NOT NULL) OR (${t.result} IS NOT NULL AND ${t.encryptedVerifier} IS NULL)`)]);
export const calendarAvailabilityCache = pgTable("calendar_availability_cache", {
  ownerId: text("owner_id").notNull(), connectionId: uuid("connection_id").notNull(), weekStartDate: date("week_start_date", { mode: "string" }).notNull(), timezone: text("timezone").notNull(),
  selectionKey: text("selection_key").notNull(), intervals: jsonb("intervals").$type<BusyInterval[]>().notNull(), fetchedAt: instant("fetched_at").notNull(), lastError: text("last_error").$type<CalendarFailure>(),
}, t => [
  primaryKey({ columns: [t.connectionId, t.weekStartDate, t.timezone] }),
  foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [calendarConnection.ownerId, calendarConnection.id], name: "calendar_cache_owned_connection_fk" }).onDelete("restrict"),
  check("calendar_cache_monday", sql`extract(isodow from ${t.weekStartDate}) = 1`), check("calendar_cache_intervals", sql`jsonb_typeof(${t.intervals}) = 'array' AND char_length(${t.selectionKey}) = 64`),
]);

export const focusableHours = pgTable("focusable_hours", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  version: integer("version").notNull(), windows: jsonb("windows").$type<FocusableWindow[]>().notNull(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  uniqueIndex("focusable_hours_owner_idx").on(t.ownerId),
  check("focusable_hours_version", sql`${t.version} > 0`),
  check("focusable_hours_windows", sql`jsonb_typeof(${t.windows}) = 'array' AND jsonb_array_length(${t.windows}) <= 70`),
  check("focusable_hours_times", sql`${t.updatedAt} >= ${t.createdAt}`),
]);

// A relational reference to the existing stable logical ID; baseline/amendment
// rows and receipt DTOs are untouched. One entry per first committed membership.
export const commitmentIdentity = pgTable("commitment_identity", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), planId: uuid("plan_id").notNull(),
}, t => [
  uniqueIndex("commitment_identity_owned_plan_idx").on(t.ownerId,t.planId,t.id),
  foreignKey({columns:[t.ownerId,t.planId],foreignColumns:[weeklyPlan.ownerId,weeklyPlan.id],name:"identity_owned_plan_fk"}).onDelete("restrict"),
]);
export const timeBlock = pgTable("time_block", {
  id: uuid("id").primaryKey(),ownerId:text("owner_id").notNull(),planId:uuid("plan_id").notNull(),commitmentId:uuid("commitment_id").notNull(),
  start:instant("start_at").notNull(),end:instant("end_at").notNull(),state:text("state").$type<"planned"|"cancelled">().notNull(),version:integer("version").notNull(),
  snapshot:jsonb("snapshot").$type<PlanningSnapshot>().notNull(),createdAt:instant("created_at").notNull(),updatedAt:instant("updated_at").notNull(),cancelledAt:instant("cancelled_at"),
}, t=>[
  foreignKey({columns:[t.ownerId,t.planId,t.commitmentId],foreignColumns:[commitmentIdentity.ownerId,commitmentIdentity.planId,commitmentIdentity.id],name:"block_owned_commitment_fk"}).onDelete("restrict"),
  uniqueIndex("time_block_owned_identity_idx").on(t.ownerId,t.id),
  index("time_block_owner_state_start_idx").on(t.ownerId,t.state,t.start),index("time_block_owner_plan_idx").on(t.ownerId,t.planId),
  check("time_block_interval",sql`${t.start} < ${t.end}`),check("time_block_version",sql`${t.version} > 0`),
  check("time_block_lifecycle",sql`(${t.state} = 'planned' AND ${t.cancelledAt} IS NULL) OR (${t.state} = 'cancelled' AND ${t.cancelledAt} IS NOT NULL)`),
  check("time_block_times",sql`${t.updatedAt} >= ${t.createdAt} AND (${t.cancelledAt} IS NULL OR ${t.cancelledAt} >= ${t.createdAt})`),
  check("time_block_snapshot",sql`jsonb_typeof(${t.snapshot}) = 'object' AND ${t.snapshot} ?& ARRAY['action','goal','milestone']`),
]);

export const focusSession = pgTable("focus_session", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), timeBlockId: uuid("time_block_id").notNull(),
  startedAt: instant("started_at").notNull(), endedAt: instant("ended_at"),
  outcome: text("outcome").$type<"completed" | "partial" | "abandoned">(), endNote: text("end_note"),
  version: integer("version").notNull(), createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  foreignKey({columns:[t.ownerId,t.timeBlockId],foreignColumns:[timeBlock.ownerId,timeBlock.id],name:"session_owned_block_fk"}).onDelete("restrict"),
  uniqueIndex("focus_session_one_active_owner_idx").on(t.ownerId).where(sql`${t.endedAt} IS NULL`),
  index("focus_session_owner_block_start_idx").on(t.ownerId,t.timeBlockId,t.startedAt),
  check("focus_session_lifecycle",sql`(${t.endedAt} IS NULL AND ${t.outcome} IS NULL AND ${t.endNote} IS NULL AND ${t.version} = 1) OR (${t.endedAt} IS NOT NULL AND ${t.endedAt} > ${t.startedAt} AND ${t.outcome} IN ('completed','partial','abandoned') AND ${t.outcome} IS NOT NULL AND ${t.version} = 2)`),
  check("focus_session_times",sql`${t.createdAt} = ${t.startedAt} AND ${t.updatedAt} = coalesce(${t.endedAt},${t.startedAt})`),
  check("focus_session_note",sql`${t.endNote} IS NULL OR (char_length(${t.endNote}) BETWEEN 1 AND 1000 AND char_length(btrim(${t.endNote})) > 0)`),
]);

export const dailyReflection = pgTable("daily_reflection", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  localDate: date("local_date", { mode: "string" }).notNull(), status: text("status").$type<"draft" | "finalized">().notNull(),
  note: text("note").notNull(), version: integer("version").notNull(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(), finalizedAt: instant("finalized_at"),
}, t => [
  uniqueIndex("daily_reflection_owner_date_idx").on(t.ownerId, t.localDate),
  check("daily_reflection_date", sql`${t.localDate} BETWEEN '2000-01-01'::date AND '9999-12-31'::date`),
  check("daily_reflection_note", sql`char_length(${t.note}) <= 4000`),
  check("daily_reflection_lifecycle", sql`(${t.status} = 'draft' AND ${t.finalizedAt} IS NULL AND ${t.version} >= 1) OR (${t.status} = 'finalized' AND ${t.finalizedAt} IS NOT NULL AND ${t.version} >= 2 AND char_length(btrim(${t.note})) > 0)`),
  check("daily_reflection_times", sql`${t.updatedAt} >= ${t.createdAt} AND (${t.finalizedAt} IS NULL OR ${t.finalizedAt} = ${t.updatedAt})`),
]);

export const weeklyReview = pgTable("weekly_review", {
  id: uuid("id").primaryKey(), ownerId: text("owner_id").notNull(), planId: uuid("plan_id").notNull(),
  status: text("status").$type<"draft" | "finalized">().notNull(), note: text("note").notNull(), version: integer("version").notNull(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(), finalizedAt: instant("finalized_at"),
}, t => [
  foreignKey({columns:[t.ownerId,t.planId],foreignColumns:[weeklyPlan.ownerId,weeklyPlan.id],name:"review_owned_plan_fk"}).onDelete("restrict"),
  uniqueIndex("weekly_review_owner_plan_idx").on(t.ownerId,t.planId),
  uniqueIndex("weekly_review_owned_plan_identity_idx").on(t.ownerId,t.planId,t.id),
  check("weekly_review_note",sql`char_length(${t.note}) <= 4000`),
  check("weekly_review_lifecycle",sql`(${t.status} = 'draft' AND ${t.finalizedAt} IS NULL AND ${t.version} >= 1) OR (${t.status} = 'finalized' AND ${t.finalizedAt} IS NOT NULL AND ${t.version} >= 2 AND char_length(btrim(${t.note})) > 0)`),
  check("weekly_review_times",sql`${t.updatedAt} >= ${t.createdAt} AND (${t.finalizedAt} IS NULL OR ${t.finalizedAt} = ${t.updatedAt})`),
]);
export const weeklyReviewDecision = pgTable("weekly_review_decision", {
  ownerId:text("owner_id").notNull(), planId:uuid("plan_id").notNull(), reviewId:uuid("review_id").notNull(), commitmentId:uuid("commitment_id").notNull(),actionId:uuid("action_id").notNull(),
  kind:text("kind").$type<"carry" | "defer" | "drop">().notNull(), proposedBudgetMinutes:integer("proposed_budget_minutes"),source:jsonb("source").$type<SourceGuard>().notNull(),
},t=>[
  primaryKey({columns:[t.reviewId,t.commitmentId]}),
  foreignKey({columns:[t.ownerId,t.planId,t.reviewId],foreignColumns:[weeklyReview.ownerId,weeklyReview.planId,weeklyReview.id],name:"decision_owned_review_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.ownerId,t.planId,t.commitmentId],foreignColumns:[commitmentIdentity.ownerId,commitmentIdentity.planId,commitmentIdentity.id],name:"decision_owned_commitment_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.ownerId,t.actionId],foreignColumns:[action.ownerId,action.id],name:"decision_owned_action_fk"}).onDelete("restrict"),
  check("weekly_review_decision_kind",sql`(${t.kind} = 'carry' AND ${t.proposedBudgetMinutes} IS NOT NULL AND ${t.proposedBudgetMinutes} BETWEEN 1 AND 10080) OR (${t.kind} IN ('defer','drop') AND ${t.proposedBudgetMinutes} IS NULL)`),
  check("weekly_review_decision_source",sql`jsonb_typeof(${t.source}) = 'object' AND ${t.source} ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion']`),
]);

export const focusCycle = pgTable("focus_cycle", {
 id:uuid("id").primaryKey(),ownerId:text("owner_id").notNull().references(()=>user.id,{onDelete:"restrict"}),title:text("title").notNull(),intent:text("intent"),
 startDate:date("start_date",{mode:"string"}).notNull(),endDate:date("end_date",{mode:"string"}).notNull(),status:text("status").$type<CycleStatus>().notNull(),version:integer("version").notNull(),
 createdAt:instant("created_at").notNull(),updatedAt:instant("updated_at").notNull(),activatedAt:instant("activated_at"),finishedAt:instant("finished_at"),archivedAt:instant("archived_at"),
},t=>[
 uniqueIndex("focus_cycle_owned_identity_idx").on(t.ownerId,t.id),uniqueIndex("focus_cycle_one_active_idx").on(t.ownerId).where(sql`${t.status} = 'active'`),index("focus_cycle_owner_created_idx").on(t.ownerId,t.createdAt),
 check("focus_cycle_title",sql`char_length(${t.title}) BETWEEN 1 AND 160 AND char_length(btrim(${t.title})) > 0`),check("focus_cycle_intent",sql`${t.intent} IS NULL OR char_length(${t.intent}) BETWEEN 1 AND 2000`),
 check("focus_cycle_dates",sql`${t.startDate} BETWEEN '2000-01-01'::date AND '9999-12-31'::date AND ${t.endDate} BETWEEN ${t.startDate} AND '9999-12-31'::date`),
 check("focus_cycle_version",sql`${t.version} >= 1`),
 check("focus_cycle_lifecycle",sql`(${t.status} = 'draft' AND ${t.activatedAt} IS NULL AND ${t.finishedAt} IS NULL AND ${t.archivedAt} IS NULL) OR (${t.status} = 'active' AND ${t.activatedAt} IS NOT NULL AND ${t.finishedAt} IS NULL AND ${t.archivedAt} IS NULL) OR (${t.status} = 'finished' AND ${t.activatedAt} IS NOT NULL AND ${t.finishedAt} IS NOT NULL AND ${t.archivedAt} IS NULL) OR (${t.status} = 'archived' AND ${t.archivedAt} IS NOT NULL)`),
 check("focus_cycle_times",sql`${t.updatedAt} >= ${t.createdAt} AND (${t.activatedAt} IS NULL OR ${t.activatedAt} BETWEEN ${t.createdAt} AND ${t.updatedAt}) AND (${t.finishedAt} IS NULL OR ${t.finishedAt} BETWEEN ${t.activatedAt} AND ${t.updatedAt}) AND (${t.archivedAt} IS NULL OR ${t.archivedAt} = ${t.updatedAt})`),
]);
export const focusCycleGoal = pgTable("focus_cycle_goal", {ownerId:text("owner_id").notNull(),cycleId:uuid("cycle_id").notNull(),goalId:uuid("goal_id").notNull(),snapshot:jsonb("snapshot").$type<CycleGoal>().notNull()},t=>[
 primaryKey({columns:[t.cycleId,t.goalId]}),foreignKey({columns:[t.ownerId,t.cycleId],foreignColumns:[focusCycle.ownerId,focusCycle.id],name:"cycle_membership_owned_cycle_fk"}).onDelete("restrict"),foreignKey({columns:[t.ownerId,t.goalId],foreignColumns:[goal.ownerId,goal.id],name:"cycle_membership_owned_goal_fk"}).onDelete("restrict"),
 check("focus_cycle_goal_snapshot",sql`jsonb_typeof(${t.snapshot}) = 'object' AND ${t.snapshot}->>'goalId' = ${t.goalId}::text AND ${t.snapshot} ?& ARRAY['goalVersion','title','outcome','archivedAt']`),
]);

// Optional inference authorization; never a Better Auth account/session.
export const chatGPTConnection=pgTable('chatgpt_connection',{
 id:uuid('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>user.id,{onDelete:'restrict'}),subject:text('subject'),email:text('email'),name:text('name'),clientId:text('client_id').notNull(),scopes:jsonb('scopes').$type<string[]>().notNull(),encryptedCredentials:text('encrypted_credentials'),status:text('status').$type<'pending'|'connected'|'needs_sign_in'|'disconnected'>().notNull(),active:boolean('active').notNull(),useForCoaching:boolean('use_for_coaching').notNull(),selectedModel:text('selected_model'),models:jsonb('models').$type<import('../modules/chatgpt/domain').Model[]>().notNull(),catalogAt:instant('catalog_at'),version:integer('version').notNull(),createdAt:instant('created_at').notNull(),updatedAt:instant('updated_at').notNull(),revocationConfirmed:boolean('revocation_confirmed'),
},t=>[uniqueIndex('chatgpt_owner_client_idx').on(t.ownerId,t.clientId),uniqueIndex('chatgpt_one_active_owner_idx').on(t.ownerId).where(sql`${t.active}`),uniqueIndex('chatgpt_owned_id_idx').on(t.ownerId,t.id),check('chatgpt_client',sql`${t.clientId} <> 'dynamic_agent_client' AND char_length(${t.clientId}) BETWEEN 1 AND 200`),check('chatgpt_version',sql`${t.version} > 0`),check('chatgpt_status',sql`${t.status} IN ('pending','connected','needs_sign_in','disconnected') AND (${t.status} <> 'connected' OR (${t.subject} IS NOT NULL AND ${t.encryptedCredentials} IS NOT NULL)) AND (${t.status} NOT IN ('needs_sign_in','disconnected') OR ${t.encryptedCredentials} IS NULL)`),check('chatgpt_times',sql`${t.updatedAt} >= ${t.createdAt}`)]);
export const chatGPTOAuthFlow=pgTable('chatgpt_oauth_flow',{
 ownerId:text('owner_id').primaryKey().references(()=>user.id,{onDelete:'restrict'}),stateHash:text('state_hash').notNull(),encryptedAttempt:text('encrypted_attempt'),expiresAt:instant('expires_at').notNull(),consumedAt:instant('consumed_at'),
},t=>[check('chatgpt_flow_once',sql`(${t.consumedAt} IS NULL AND ${t.encryptedAttempt} IS NOT NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.encryptedAttempt} IS NULL)`)]);
