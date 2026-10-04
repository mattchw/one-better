CREATE TABLE "focus_cycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"intent" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "focus_cycle_title" CHECK (char_length("focus_cycle"."title") BETWEEN 1 AND 160 AND char_length(btrim("focus_cycle"."title")) > 0),
	CONSTRAINT "focus_cycle_intent" CHECK ("focus_cycle"."intent" IS NULL OR char_length("focus_cycle"."intent") BETWEEN 1 AND 2000),
	CONSTRAINT "focus_cycle_dates" CHECK ("focus_cycle"."start_date" BETWEEN '2000-01-01'::date AND '9999-12-31'::date AND "focus_cycle"."end_date" BETWEEN "focus_cycle"."start_date" AND '9999-12-31'::date),
	CONSTRAINT "focus_cycle_version" CHECK ("focus_cycle"."version" >= 1),
	CONSTRAINT "focus_cycle_lifecycle" CHECK (("focus_cycle"."status" = 'draft' AND "focus_cycle"."activated_at" IS NULL AND "focus_cycle"."finished_at" IS NULL AND "focus_cycle"."archived_at" IS NULL) OR ("focus_cycle"."status" = 'active' AND "focus_cycle"."activated_at" IS NOT NULL AND "focus_cycle"."finished_at" IS NULL AND "focus_cycle"."archived_at" IS NULL) OR ("focus_cycle"."status" = 'finished' AND "focus_cycle"."activated_at" IS NOT NULL AND "focus_cycle"."finished_at" IS NOT NULL AND "focus_cycle"."archived_at" IS NULL) OR ("focus_cycle"."status" = 'archived' AND "focus_cycle"."archived_at" IS NOT NULL)),
	CONSTRAINT "focus_cycle_times" CHECK ("focus_cycle"."updated_at" >= "focus_cycle"."created_at" AND ("focus_cycle"."activated_at" IS NULL OR "focus_cycle"."activated_at" BETWEEN "focus_cycle"."created_at" AND "focus_cycle"."updated_at") AND ("focus_cycle"."finished_at" IS NULL OR "focus_cycle"."finished_at" BETWEEN "focus_cycle"."activated_at" AND "focus_cycle"."updated_at") AND ("focus_cycle"."archived_at" IS NULL OR "focus_cycle"."archived_at" = "focus_cycle"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "focus_cycle_goal" (
	"owner_id" text NOT NULL,
	"cycle_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "focus_cycle_goal_cycle_id_goal_id_pk" PRIMARY KEY("cycle_id","goal_id"),
	CONSTRAINT "focus_cycle_goal_snapshot" CHECK (jsonb_typeof("focus_cycle_goal"."snapshot") = 'object' AND "focus_cycle_goal"."snapshot"->>'goalId' = "focus_cycle_goal"."goal_id"::text AND "focus_cycle_goal"."snapshot" ?& ARRAY['goalVersion','title','outcome','archivedAt'])
);
--> statement-breakpoint
ALTER TABLE "focus_cycle" ADD CONSTRAINT "focus_cycle_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_cycle_owned_identity_idx" ON "focus_cycle" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "focus_cycle_goal" ADD CONSTRAINT "cycle_membership_owned_cycle_fk" FOREIGN KEY ("owner_id","cycle_id") REFERENCES "public"."focus_cycle"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_cycle_goal" ADD CONSTRAINT "cycle_membership_owned_goal_fk" FOREIGN KEY ("owner_id","goal_id") REFERENCES "public"."goal"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focus_cycle_one_active_idx" ON "focus_cycle" USING btree ("owner_id") WHERE "focus_cycle"."status" = 'active';--> statement-breakpoint
CREATE INDEX "focus_cycle_owner_created_idx" ON "focus_cycle" USING btree ("owner_id","created_at");
--> statement-breakpoint
CREATE FUNCTION guard_focus_cycle_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Focus Cycle identity/version is immutable'; END IF;
 IF OLD.status = 'archived' OR (OLD.status = 'finished' AND (NEW.status <> 'archived' OR (to_jsonb(NEW) - ARRAY['status','version','updated_at','archived_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updated_at','archived_at']))) THEN RAISE EXCEPTION 'Terminal Focus Cycle is immutable'; END IF;
 IF (OLD.status = 'active' AND NEW.status NOT IN ('active','finished','archived')) OR (OLD.status = 'draft' AND NEW.status NOT IN ('draft','active','archived')) THEN RAISE EXCEPTION 'Invalid Focus Cycle transition'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER focus_cycle_update_guard BEFORE UPDATE ON focus_cycle FOR EACH ROW EXECUTE FUNCTION guard_focus_cycle_update();
--> statement-breakpoint
CREATE FUNCTION guard_focus_cycle_member_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_state text;
BEGIN
 SELECT status INTO cycle_state FROM focus_cycle WHERE owner_id = NEW.owner_id AND id = NEW.cycle_id FOR UPDATE;
 IF cycle_state IN ('finished','archived') THEN RAISE EXCEPTION 'Terminal Focus Cycle membership is immutable'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW.owner_id <> OLD.owner_id OR NEW.cycle_id <> OLD.cycle_id OR NEW.goal_id <> OLD.goal_id) THEN RAISE EXCEPTION 'Membership identity is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER focus_cycle_member_write_guard BEFORE INSERT OR UPDATE ON focus_cycle_goal FOR EACH ROW EXECUTE FUNCTION guard_focus_cycle_member_write();
