CREATE TABLE "chatgpt_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"subject" text,
	"email" text,
	"name" text,
	"client_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"encrypted_credentials" text,
	"status" text NOT NULL,
	"active" boolean NOT NULL,
	"use_for_coaching" boolean NOT NULL,
	"selected_model" text,
	"models" jsonb NOT NULL,
	"catalog_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revocation_confirmed" boolean,
	CONSTRAINT "chatgpt_client" CHECK ("chatgpt_connection"."client_id" <> 'dynamic_agent_client' AND char_length("chatgpt_connection"."client_id") BETWEEN 1 AND 200),
	CONSTRAINT "chatgpt_version" CHECK ("chatgpt_connection"."version" > 0),
	CONSTRAINT "chatgpt_status" CHECK ("chatgpt_connection"."status" IN ('pending','connected','needs_sign_in','disconnected') AND ("chatgpt_connection"."status" <> 'connected' OR ("chatgpt_connection"."subject" IS NOT NULL AND "chatgpt_connection"."encrypted_credentials" IS NOT NULL)) AND ("chatgpt_connection"."status" NOT IN ('needs_sign_in','disconnected') OR "chatgpt_connection"."encrypted_credentials" IS NULL)),
	CONSTRAINT "chatgpt_times" CHECK ("chatgpt_connection"."updated_at" >= "chatgpt_connection"."created_at")
);
--> statement-breakpoint
CREATE TABLE "chatgpt_oauth_flow" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_attempt" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "chatgpt_flow_once" CHECK (("chatgpt_oauth_flow"."consumed_at" IS NULL AND "chatgpt_oauth_flow"."encrypted_attempt" IS NOT NULL) OR ("chatgpt_oauth_flow"."consumed_at" IS NOT NULL AND "chatgpt_oauth_flow"."encrypted_attempt" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "chatgpt_connection" ADD CONSTRAINT "chatgpt_connection_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatgpt_oauth_flow" ADD CONSTRAINT "chatgpt_oauth_flow_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chatgpt_owner_client_idx" ON "chatgpt_connection" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chatgpt_one_active_owner_idx" ON "chatgpt_connection" USING btree ("owner_id") WHERE "chatgpt_connection"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "chatgpt_owned_id_idx" ON "chatgpt_connection" USING btree ("owner_id","id");