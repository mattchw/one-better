CREATE TABLE "weekly_commitment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"budget_minutes" integer NOT NULL,
	"source_guard" jsonb NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weekly_commitment_budget" CHECK ("weekly_commitment"."budget_minutes" BETWEEN 1 AND 10080),
	CONSTRAINT "weekly_commitment_source" CHECK (jsonb_typeof("weekly_commitment"."source_guard") = 'object' AND "weekly_commitment"."source_guard" ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion']),
	CONSTRAINT "weekly_commitment_snapshot" CHECK ("weekly_commitment"."snapshot" IS NULL OR (jsonb_typeof("weekly_commitment"."snapshot") = 'object' AND "weekly_commitment"."snapshot" ?& ARRAY['action','goal','milestone'] AND "weekly_commitment"."snapshot"->'action'->>'id' = "weekly_commitment"."action_id"::text))
);
--> statement-breakpoint
CREATE TABLE "weekly_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"week_start_date" date NOT NULL,
	"timezone" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"provisional_capacity_minutes" integer NOT NULL,
	"reserve_minutes" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "weekly_plan_monday" CHECK (extract(isodow from "weekly_plan"."week_start_date") = 1 AND "weekly_plan"."week_start_date" BETWEEN '2000-01-01'::date AND '9999-12-31'::date),
	CONSTRAINT "weekly_plan_capacity" CHECK ("weekly_plan"."provisional_capacity_minutes" BETWEEN 1 AND 10080 AND "weekly_plan"."reserve_minutes" >= 0 AND "weekly_plan"."reserve_minutes" < "weekly_plan"."provisional_capacity_minutes"),
	CONSTRAINT "weekly_plan_version" CHECK ("weekly_plan"."version" > 0),
	CONSTRAINT "weekly_plan_lifecycle" CHECK (("weekly_plan"."state" = 'draft' AND "weekly_plan"."committed_at" IS NULL) OR ("weekly_plan"."state" = 'committed' AND "weekly_plan"."committed_at" IS NOT NULL AND "weekly_plan"."committed_at" >= "weekly_plan"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_commitment_plan_action_idx" ON "weekly_commitment" USING btree ("owner_id","plan_id","action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_plan_owner_week_idx" ON "weekly_plan" USING btree ("owner_id","week_start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_plan_owner_identity_idx" ON "weekly_plan" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_owner_identity_idx" ON "action" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "weekly_commitment" ADD CONSTRAINT "commitment_owned_plan_fk" FOREIGN KEY ("owner_id","plan_id") REFERENCES "public"."weekly_plan"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_commitment" ADD CONSTRAINT "commitment_owned_action_fk" FOREIGN KEY ("owner_id","action_id") REFERENCES "public"."action"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan" ADD CONSTRAINT "weekly_plan_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;