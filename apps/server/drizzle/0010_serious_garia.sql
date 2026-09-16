ALTER TABLE "segment_seat" ADD COLUMN "zone_external_id" text;--> statement-breakpoint
ALTER TABLE "segment_seating_plan" ADD COLUMN "sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_venue_zone" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_venue_zone" ADD COLUMN "parent_external_id" text;--> statement-breakpoint
ALTER TABLE "venue_zone" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_zone" ADD COLUMN "parent_external_id" text;