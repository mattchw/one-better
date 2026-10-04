CREATE TABLE "weekly_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "weekly_review_note" CHECK (char_length("weekly_review"."note") <= 4000),
	CONSTRAINT "weekly_review_lifecycle" CHECK (("weekly_review"."status" = 'draft' AND "weekly_review"."finalized_at" IS NULL AND "weekly_review"."version" >= 1) OR ("weekly_review"."status" = 'finalized' AND "weekly_review"."finalized_at" IS NOT NULL AND "weekly_review"."version" >= 2 AND char_length(btrim("weekly_review"."note")) > 0)),
	CONSTRAINT "weekly_review_times" CHECK ("weekly_review"."updated_at" >= "weekly_review"."created_at" AND ("weekly_review"."finalized_at" IS NULL OR "weekly_review"."finalized_at" = "weekly_review"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "weekly_review_decision" (
	"owner_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"proposed_budget_minutes" integer,
	"source" jsonb NOT NULL,
	CONSTRAINT "weekly_review_decision_review_id_commitment_id_pk" PRIMARY KEY("review_id","commitment_id"),
	CONSTRAINT "weekly_review_decision_kind" CHECK (("weekly_review_decision"."kind" = 'carry' AND "weekly_review_decision"."proposed_budget_minutes" IS NOT NULL AND "weekly_review_decision"."proposed_budget_minutes" BETWEEN 1 AND 10080) OR ("weekly_review_decision"."kind" IN ('defer','drop') AND "weekly_review_decision"."proposed_budget_minutes" IS NULL)),
	CONSTRAINT "weekly_review_decision_source" CHECK (jsonb_typeof("weekly_review_decision"."source") = 'object' AND "weekly_review_decision"."source" ?& ARRAY['actionVersion','goalId','goalVersion','milestoneId','milestoneVersion'])
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_review_owner_plan_idx" ON "weekly_review" USING btree ("owner_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_review_owned_plan_identity_idx" ON "weekly_review" USING btree ("owner_id","plan_id","id");
--> statement-breakpoint
ALTER TABLE "weekly_review" ADD CONSTRAINT "review_owned_plan_fk" FOREIGN KEY ("owner_id","plan_id") REFERENCES "public"."weekly_plan"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_review_decision" ADD CONSTRAINT "decision_owned_review_fk" FOREIGN KEY ("owner_id","plan_id","review_id") REFERENCES "public"."weekly_review"("owner_id","plan_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_review_decision" ADD CONSTRAINT "decision_owned_commitment_fk" FOREIGN KEY ("owner_id","plan_id","commitment_id") REFERENCES "public"."commitment_identity"("owner_id","plan_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_review_decision" ADD CONSTRAINT "decision_owned_action_fk" FOREIGN KEY ("owner_id","action_id") REFERENCES "public"."action"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION protect_weekly_review_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Weekly review history is immutable; drafts require the next version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER weekly_review_history BEFORE UPDATE ON weekly_review FOR EACH ROW EXECUTE FUNCTION protect_weekly_review_history();
--> statement-breakpoint
CREATE FUNCTION protect_weekly_review_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.review_id IS DISTINCT FROM OLD.review_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.commitment_id IS DISTINCT FROM OLD.commitment_id) THEN
    RAISE EXCEPTION 'Review decision identity is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM weekly_review WHERE owner_id = NEW.owner_id AND id = NEW.review_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finalized review decisions are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER weekly_review_decision_history BEFORE INSERT OR UPDATE ON weekly_review_decision FOR EACH ROW EXECUTE FUNCTION protect_weekly_review_decision();
