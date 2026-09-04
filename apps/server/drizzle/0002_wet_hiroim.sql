ALTER TABLE "activity" ADD COLUMN "itinerary_share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_activity_itinerary_share_token" ON "activity" USING btree ("itinerary_share_token");