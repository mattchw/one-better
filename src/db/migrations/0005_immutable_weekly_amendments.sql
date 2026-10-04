CREATE TABLE "amendment_commitment" (
	"amendment_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"budget_minutes" integer NOT NULL,
	"source_guard" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "amendment_commitment_amendment_id_id_pk" PRIMARY KEY("amendment_id","id"),
	CONSTRAINT "amendment_commitment_budget" CHECK ("amendment_commitment"."budget_minutes" BETWEEN 1 AND 10080),
	CONSTRAINT "amendment_commitment_source" CHECK (jsonb_typeof("amendment_commitment"."source_guard") = 'object' AND "amendment_commitment"."source_guard" ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion']),
	CONSTRAINT "amendment_commitment_snapshot" CHECK (jsonb_typeof("amendment_commitment"."snapshot") = 'object' AND "amendment_commitment"."snapshot" ?& ARRAY['action','goal','milestone'] AND ("amendment_commitment"."snapshot"->'action'->>'id') IS NOT NULL AND "amendment_commitment"."snapshot"->'action'->>'id' = "amendment_commitment"."action_id"::text)
);
--> statement-breakpoint
CREATE TABLE "weekly_plan_amendment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"reason" text NOT NULL,
	"version" integer NOT NULL,
	"provisional_capacity_minutes" integer NOT NULL,
	"reserve_minutes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "amendment_sequence_version" CHECK ("weekly_plan_amendment"."sequence_number" > 0 AND "weekly_plan_amendment"."version" > 1),
	CONSTRAINT "amendment_reason" CHECK (char_length("weekly_plan_amendment"."reason") BETWEEN 1 AND 500 AND char_length(btrim("weekly_plan_amendment"."reason")) > 0),
	CONSTRAINT "amendment_capacity" CHECK (("weekly_plan_amendment"."provisional_capacity_minutes" BETWEEN 1 AND 10080 AND "weekly_plan_amendment"."reserve_minutes" >= 0 AND "weekly_plan_amendment"."reserve_minutes" < "weekly_plan_amendment"."provisional_capacity_minutes") OR ("weekly_plan_amendment"."provisional_capacity_minutes" = 0 AND "weekly_plan_amendment"."reserve_minutes" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_commitment_action_idx" ON "amendment_commitment" USING btree ("amendment_id","action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_plan_sequence_idx" ON "weekly_plan_amendment" USING btree ("plan_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "amendment_owner_identity_idx" ON "weekly_plan_amendment" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "amendment_commitment" ADD CONSTRAINT "amendment_commitment_owned_amendment_fk" FOREIGN KEY ("owner_id","amendment_id") REFERENCES "public"."weekly_plan_amendment"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_commitment" ADD CONSTRAINT "amendment_commitment_owned_action_fk" FOREIGN KEY ("owner_id","action_id") REFERENCES "public"."action"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_plan_amendment" ADD CONSTRAINT "amendment_owned_plan_fk" FOREIGN KEY ("owner_id","plan_id") REFERENCES "public"."weekly_plan"("owner_id","id") ON DELETE restrict ON UPDATE no action;