ALTER TABLE "activity_member" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_member" ADD COLUMN "sort_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "activity_id" ORDER BY "id")::integer AS "sort_index"
  FROM "activity_member"
)
UPDATE "activity_member" AS activity_member
SET "sort_index" = ranked."sort_index"
FROM ranked
WHERE activity_member."id" = ranked."id";--> statement-breakpoint
CREATE INDEX "idx_activity_member_order" ON "activity_member" USING btree ("activity_id","sort_order","sort_index","id");
