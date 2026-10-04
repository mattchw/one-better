CREATE UNIQUE INDEX "milestone_owner_goal_identity_idx" ON "milestone" USING btree ("owner_id","goal_id","id");
--> statement-breakpoint
CREATE TABLE "action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"done_when" text,
	"estimate_minutes" integer,
	"state" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "action_title_length" CHECK (char_length("action"."title") BETWEEN 1 AND 160 AND char_length(btrim("action"."title")) > 0),
	CONSTRAINT "action_done_when_length" CHECK ("action"."done_when" IS NULL OR char_length("action"."done_when") BETWEEN 1 AND 2000),
	CONSTRAINT "action_estimate_bounds" CHECK ("action"."estimate_minutes" IS NULL OR "action"."estimate_minutes" BETWEEN 1 AND 10080),
	CONSTRAINT "action_positive_version" CHECK ("action"."version" > 0),
	CONSTRAINT "action_lifecycle" CHECK (("action"."state" = 'open' AND "action"."completed_at" IS NULL AND "action"."archived_at" IS NULL) OR ("action"."state" = 'completed' AND "action"."completed_at" IS NOT NULL AND "action"."archived_at" IS NULL) OR ("action"."state" = 'archived' AND "action"."archived_at" IS NOT NULL AND "action"."completed_at" IS NULL)),
	CONSTRAINT "action_terminal_time" CHECK (("action"."completed_at" IS NULL OR "action"."completed_at" >= "action"."created_at") AND ("action"."archived_at" IS NULL OR "action"."archived_at" >= "action"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_owned_goal_fk" FOREIGN KEY ("owner_id","goal_id") REFERENCES "public"."goal"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_owned_milestone_fk" FOREIGN KEY ("owner_id","goal_id","milestone_id") REFERENCES "public"."milestone"("owner_id","goal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_owner_goal_state_created_idx" ON "action" USING btree ("owner_id","goal_id","state","created_at","id");
