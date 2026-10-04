CREATE TABLE "ai_recommendation_run" (
	"owner_id" text NOT NULL,
	"id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"week" date NOT NULL,
	"fingerprint" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"recommendations" jsonb NOT NULL,
	"failure" text,
	"usage" jsonb,
	"latency_ms" integer,
	CONSTRAINT "ai_recommendation_run_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "coaching_hashes" CHECK (char_length("ai_recommendation_run"."fingerprint")=64 AND char_length("ai_recommendation_run"."request_hash")=64),
	CONSTRAINT "coaching_context" CHECK ("ai_recommendation_run"."context_type" IN ('calendar','weekly_review') AND extract(isodow FROM "ai_recommendation_run"."week")=1),
	CONSTRAINT "coaching_provider" CHECK ("ai_recommendation_run"."provider" IN ('openai','anthropic') AND char_length("ai_recommendation_run"."model") BETWEEN 1 AND 160),
	CONSTRAINT "coaching_result" CHECK (jsonb_typeof("ai_recommendation_run"."recommendations")='array' AND jsonb_array_length("ai_recommendation_run"."recommendations")<=3 AND octet_length("ai_recommendation_run"."recommendations"::text)<=64000),
	CONSTRAINT "coaching_state" CHECK (("ai_recommendation_run"."status"='pending' AND "ai_recommendation_run"."failure" IS NULL AND "ai_recommendation_run"."latency_ms" IS NULL AND "ai_recommendation_run"."usage" IS NULL AND "ai_recommendation_run"."recommendations"='[]'::jsonb) OR ("ai_recommendation_run"."status"='succeeded' AND "ai_recommendation_run"."failure" IS NULL AND "ai_recommendation_run"."latency_ms" IS NOT NULL AND "ai_recommendation_run"."latency_ms">=0) OR ("ai_recommendation_run"."status"='failed' AND "ai_recommendation_run"."failure" IS NOT NULL AND "ai_recommendation_run"."recommendations"='[]'::jsonb AND "ai_recommendation_run"."failure" IN ('timeout','authentication','rate_limit','model_unavailable','unavailable','invalid_output','refusal','context_too_large') AND "ai_recommendation_run"."latency_ms" IS NOT NULL AND "ai_recommendation_run"."latency_ms">=0))
);
--> statement-breakpoint
ALTER TABLE "ai_recommendation_run" ADD CONSTRAINT "ai_recommendation_run_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coaching_owned_scope_created_idx" ON "ai_recommendation_run" USING btree ("owner_id","context_type","week","created_at");--> statement-breakpoint
CREATE FUNCTION guard_coaching_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('succeeded','failed') OR
    (NEW.owner_id,NEW.id,NEW.context_type,NEW.week,NEW.fingerprint,NEW.request_hash,NEW.provider,NEW.model,NEW.generated_at,NEW.created_at)
    IS DISTINCT FROM
    (OLD.owner_id,OLD.id,OLD.context_type,OLD.week,OLD.fingerprint,OLD.request_hash,OLD.provider,OLD.model,OLD.generated_at,OLD.created_at) THEN
    RAISE EXCEPTION 'Coaching run identity and terminal result are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER coaching_run_update_guard BEFORE UPDATE ON ai_recommendation_run
FOR EACH ROW EXECUTE FUNCTION guard_coaching_run_update();
