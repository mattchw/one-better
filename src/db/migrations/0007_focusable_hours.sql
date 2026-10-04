CREATE TABLE "focusable_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"windows" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "focusable_hours_version" CHECK ("focusable_hours"."version" > 0),
	CONSTRAINT "focusable_hours_windows" CHECK (jsonb_typeof("focusable_hours"."windows") = 'array' AND jsonb_array_length("focusable_hours"."windows") <= 70),
	CONSTRAINT "focusable_hours_times" CHECK ("focusable_hours"."updated_at" >= "focusable_hours"."created_at")
);
--> statement-breakpoint
ALTER TABLE "focusable_hours" ADD CONSTRAINT "focusable_hours_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "focusable_hours_owner_idx" ON "focusable_hours" USING btree ("owner_id");