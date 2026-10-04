CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"success_condition" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"evidence" text,
	CONSTRAINT "milestone_title_length" CHECK (char_length("milestone"."title") BETWEEN 1 AND 160 AND char_length(btrim("milestone"."title")) > 0),
	CONSTRAINT "milestone_condition_length" CHECK (char_length("milestone"."success_condition") BETWEEN 1 AND 2000 AND char_length(btrim("milestone"."success_condition")) > 0),
	CONSTRAINT "milestone_evidence_length" CHECK ("milestone"."evidence" IS NULL OR char_length("milestone"."evidence") BETWEEN 1 AND 2000),
	CONSTRAINT "milestone_positive_version" CHECK ("milestone"."version" > 0),
	CONSTRAINT "milestone_lifecycle" CHECK (("milestone"."state" = 'active' AND "milestone"."completed_at" IS NULL AND "milestone"."archived_at" IS NULL AND "milestone"."evidence" IS NULL) OR ("milestone"."state" = 'completed' AND "milestone"."completed_at" IS NOT NULL AND "milestone"."archived_at" IS NULL) OR ("milestone"."state" = 'archived' AND "milestone"."archived_at" IS NOT NULL AND "milestone"."completed_at" IS NULL AND "milestone"."evidence" IS NULL)),
	CONSTRAINT "milestone_terminal_time" CHECK (("milestone"."completed_at" IS NULL OR "milestone"."completed_at" >= "milestone"."created_at") AND ("milestone"."archived_at" IS NULL OR "milestone"."archived_at" >= "milestone"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_owned_goal_fk" FOREIGN KEY ("owner_id","goal_id") REFERENCES "public"."goal"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_owner_goal_state_created_idx" ON "milestone" USING btree ("owner_id","goal_id","state","created_at","id");