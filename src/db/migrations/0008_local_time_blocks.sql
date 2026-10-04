CREATE TABLE "commitment_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "time_block_interval" CHECK ("time_block"."start_at" < "time_block"."end_at"),
	CONSTRAINT "time_block_version" CHECK ("time_block"."version" > 0),
	CONSTRAINT "time_block_lifecycle" CHECK (("time_block"."state" = 'planned' AND "time_block"."cancelled_at" IS NULL) OR ("time_block"."state" = 'cancelled' AND "time_block"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "time_block_times" CHECK ("time_block"."updated_at" >= "time_block"."created_at" AND ("time_block"."cancelled_at" IS NULL OR "time_block"."cancelled_at" >= "time_block"."created_at")),
	CONSTRAINT "time_block_snapshot" CHECK (jsonb_typeof("time_block"."snapshot") = 'object' AND "time_block"."snapshot" ?& ARRAY['action','goal','milestone'])
);
--> statement-breakpoint
ALTER TABLE "commitment_identity" ADD CONSTRAINT "identity_owned_plan_fk" FOREIGN KEY ("owner_id","plan_id") REFERENCES "public"."weekly_plan"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commitment_identity_owned_plan_idx" ON "commitment_identity" USING btree ("owner_id","plan_id","id");--> statement-breakpoint
ALTER TABLE "time_block" ADD CONSTRAINT "block_owned_commitment_fk" FOREIGN KEY ("owner_id","plan_id","commitment_id") REFERENCES "public"."commitment_identity"("owner_id","plan_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_block_owner_state_start_idx" ON "time_block" USING btree ("owner_id","state","start_at");--> statement-breakpoint
CREATE INDEX "time_block_owner_plan_idx" ON "time_block" USING btree ("owner_id","plan_id");
--> statement-breakpoint
-- Existing immutable snapshots already carry stable logical IDs. Register all
-- historical identities, including those later dropped, without rewriting them.
INSERT INTO commitment_identity (id, owner_id, plan_id)
SELECT c.id, c.owner_id, c.plan_id FROM weekly_commitment c
JOIN weekly_plan p ON p.id=c.plan_id AND p.owner_id=c.owner_id WHERE p.state='committed'
UNION
SELECT c.id, c.owner_id, a.plan_id FROM amendment_commitment c
JOIN weekly_plan_amendment a ON a.id=c.amendment_id AND a.owner_id=c.owner_id
ON CONFLICT DO NOTHING;
