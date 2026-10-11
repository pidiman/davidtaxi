ALTER TABLE "rides" ADD COLUMN "track_token" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "track_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_track_token_unique" UNIQUE("track_token");