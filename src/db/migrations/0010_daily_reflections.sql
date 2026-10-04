CREATE TABLE "daily_reflection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"local_date" date NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "daily_reflection_date" CHECK ("daily_reflection"."local_date" BETWEEN '2000-01-01'::date AND '9999-12-31'::date),
	CONSTRAINT "daily_reflection_note" CHECK (char_length("daily_reflection"."note") <= 4000),
	CONSTRAINT "daily_reflection_lifecycle" CHECK (("daily_reflection"."status" = 'draft' AND "daily_reflection"."finalized_at" IS NULL AND "daily_reflection"."version" >= 1) OR ("daily_reflection"."status" = 'finalized' AND "daily_reflection"."finalized_at" IS NOT NULL AND "daily_reflection"."version" >= 2 AND char_length(btrim("daily_reflection"."note")) > 0)),
	CONSTRAINT "daily_reflection_times" CHECK ("daily_reflection"."updated_at" >= "daily_reflection"."created_at" AND ("daily_reflection"."finalized_at" IS NULL OR "daily_reflection"."finalized_at" = "daily_reflection"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "daily_reflection" ADD CONSTRAINT "daily_reflection_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reflection_owner_date_idx" ON "daily_reflection" USING btree ("owner_id","local_date");
--> statement-breakpoint
CREATE FUNCTION protect_daily_reflection_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.local_date IS DISTINCT FROM OLD.local_date
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Daily reflection history is immutable; drafts require the next version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER daily_reflection_history BEFORE UPDATE ON daily_reflection FOR EACH ROW EXECUTE FUNCTION protect_daily_reflection_history();
