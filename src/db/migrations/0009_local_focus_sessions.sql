CREATE UNIQUE INDEX "time_block_owned_identity_idx" ON "time_block" USING btree ("owner_id","id");
--> statement-breakpoint
CREATE TABLE "focus_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"time_block_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text,
	"end_note" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "focus_session_lifecycle" CHECK (("focus_session"."ended_at" IS NULL AND "focus_session"."outcome" IS NULL AND "focus_session"."end_note" IS NULL AND "focus_session"."version" = 1) OR ("focus_session"."ended_at" IS NOT NULL AND "focus_session"."ended_at" > "focus_session"."started_at" AND "focus_session"."outcome" IN ('completed','partial','abandoned') AND "focus_session"."outcome" IS NOT NULL AND "focus_session"."version" = 2)),
	CONSTRAINT "focus_session_times" CHECK ("focus_session"."created_at" = "focus_session"."started_at" AND "focus_session"."updated_at" = coalesce("focus_session"."ended_at","focus_session"."started_at")),
	CONSTRAINT "focus_session_note" CHECK ("focus_session"."end_note" IS NULL OR (char_length("focus_session"."end_note") BETWEEN 1 AND 1000 AND char_length(btrim("focus_session"."end_note")) > 0))
);
--> statement-breakpoint
ALTER TABLE "focus_session" ADD CONSTRAINT "session_owned_block_fk" FOREIGN KEY ("owner_id","time_block_id") REFERENCES "public"."time_block"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_session_one_active_owner_idx" ON "focus_session" USING btree ("owner_id") WHERE "focus_session"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "focus_session_owner_block_start_idx" ON "focus_session" USING btree ("owner_id","time_block_id","started_at");--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION protect_focus_session_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.ended_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.time_block_id IS DISTINCT FROM OLD.time_block_id OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Focus session history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER focus_session_history BEFORE UPDATE ON focus_session FOR EACH ROW EXECUTE FUNCTION protect_focus_session_history();
