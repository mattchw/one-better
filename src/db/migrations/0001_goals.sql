CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"outcome" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "goal_title_length" CHECK (char_length("goal"."title") BETWEEN 1 AND 160 AND char_length(btrim("goal"."title")) > 0),
	CONSTRAINT "goal_outcome_length" CHECK (char_length("goal"."outcome") BETWEEN 1 AND 2000 AND char_length(btrim("goal"."outcome")) > 0),
	CONSTRAINT "goal_positive_version" CHECK ("goal"."version" > 0),
	CONSTRAINT "goal_archive_time" CHECK ("goal"."archived_at" IS NULL OR "goal"."archived_at" >= "goal"."created_at")
);
--> statement-breakpoint
CREATE TABLE "mutation_receipt" (
	"owner_id" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipt_owner_id_mutation_id_pk" PRIMARY KEY("owner_id","mutation_id"),
	CONSTRAINT "receipt_hash_length" CHECK (char_length("mutation_receipt"."request_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipt" ADD CONSTRAINT "mutation_receipt_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_owner_archive_created_idx" ON "goal" USING btree ("owner_id","archived_at","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_owner_identity_idx" ON "goal" USING btree ("owner_id","id");