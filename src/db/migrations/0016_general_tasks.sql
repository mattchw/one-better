ALTER TABLE "action" ALTER COLUMN "goal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_general_has_no_milestone" CHECK ("action"."goal_id" IS NOT NULL OR "action"."milestone_id" IS NULL);
--> statement-breakpoint
-- Convert only the exact container created by Calendar onboarding. Retain all
-- historical snapshots, receipts, blocks, sessions and review decisions.
UPDATE "action" a SET "goal_id" = NULL, "milestone_id" = NULL, "version" = a."version" + 1, "updated_at" = now()
FROM "goal" g WHERE a."owner_id" = g."owner_id" AND a."goal_id" = g."id"
AND g."title" = 'Weekly priorities' AND g."outcome" = 'Make progress on the tasks I choose for my weekly plans.';
--> statement-breakpoint
UPDATE "goal" SET "archived_at" = now(), "updated_at" = now(), "version" = "version" + 1
WHERE "archived_at" IS NULL AND "title" = 'Weekly priorities'
AND "outcome" = 'Make progress on the tasks I choose for my weekly plans.';
