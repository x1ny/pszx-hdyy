ALTER TABLE "activity_member" ALTER COLUMN "sort_order" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "activity_member" ALTER COLUMN "sort_order" DROP NOT NULL;--> statement-breakpoint
-- The first ordering release used 0 as the implicit default, so it could not
-- distinguish an untouched row from an explicitly assigned zero.
UPDATE "activity_member" SET "sort_order" = NULL WHERE "sort_order" = 0;
