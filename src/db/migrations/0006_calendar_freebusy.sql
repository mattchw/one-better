CREATE TABLE "calendar_availability_cache" (
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"week_start_date" date NOT NULL,
	"timezone" text NOT NULL,
	"selection_key" text NOT NULL,
	"intervals" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_error" text,
	CONSTRAINT "calendar_availability_cache_connection_id_week_start_date_timezone_pk" PRIMARY KEY("connection_id","week_start_date","timezone"),
	CONSTRAINT "calendar_cache_monday" CHECK (extract(isodow from "calendar_availability_cache"."week_start_date") = 1),
	CONSTRAINT "calendar_cache_intervals" CHECK (jsonb_typeof("calendar_availability_cache"."intervals") = 'array' AND char_length("calendar_availability_cache"."selection_key") = 64)
);
--> statement-breakpoint
CREATE TABLE "google_calendar_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"provider_account_id" text,
	"encrypted_credentials" text,
	"access_expires_at" timestamp with time zone,
	"granted_scopes" jsonb NOT NULL,
	"calendars" jsonb NOT NULL,
	"selected_calendar_ids" jsonb NOT NULL,
	"list_fetched_at" timestamp with time zone,
	"list_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_connection_version" CHECK ("google_calendar_connection"."version" > 0),
	CONSTRAINT "calendar_connection_lifecycle" CHECK (("google_calendar_connection"."state" = 'connected' AND "google_calendar_connection"."encrypted_credentials" IS NOT NULL AND "google_calendar_connection"."access_expires_at" IS NOT NULL) OR ("google_calendar_connection"."state" = 'reauthorization_required') OR ("google_calendar_connection"."state" = 'disconnected' AND "google_calendar_connection"."encrypted_credentials" IS NULL AND "google_calendar_connection"."access_expires_at" IS NULL AND "google_calendar_connection"."selected_calendar_ids" = '[]'::jsonb AND "google_calendar_connection"."calendars" = '[]'::jsonb AND "google_calendar_connection"."granted_scopes" = '[]'::jsonb AND "google_calendar_connection"."provider_account_id" IS NULL)),
	CONSTRAINT "calendar_connection_arrays" CHECK (jsonb_typeof("google_calendar_connection"."calendars") = 'array' AND jsonb_typeof("google_calendar_connection"."selected_calendar_ids") = 'array' AND jsonb_array_length("google_calendar_connection"."selected_calendar_ids") <= 50 AND jsonb_typeof("google_calendar_connection"."granted_scopes") = 'array')
);
--> statement-breakpoint
CREATE TABLE "calendar_oauth_flow" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_verifier" text,
	"expires_at" timestamp with time zone NOT NULL,
	"result" text,
	CONSTRAINT "calendar_oauth_flow_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "calendar_oauth_hash" CHECK (char_length("calendar_oauth_flow"."state_hash") = 64),
	CONSTRAINT "calendar_oauth_secret" CHECK (("calendar_oauth_flow"."result" IS NULL AND "calendar_oauth_flow"."encrypted_verifier" IS NOT NULL) OR ("calendar_oauth_flow"."result" IS NOT NULL AND "calendar_oauth_flow"."encrypted_verifier" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_owner_idx" ON "google_calendar_connection" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_owner_identity_idx" ON "google_calendar_connection" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "calendar_availability_cache" ADD CONSTRAINT "calendar_cache_owned_connection_fk" FOREIGN KEY ("owner_id","connection_id") REFERENCES "public"."google_calendar_connection"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_connection" ADD CONSTRAINT "google_calendar_connection_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_oauth_flow" ADD CONSTRAINT "calendar_oauth_flow_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;