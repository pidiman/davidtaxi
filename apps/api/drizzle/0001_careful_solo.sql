CREATE TYPE "public"."ride_source" AS ENUM('dispatch', 'street');--> statement-breakpoint
ALTER TABLE "rides" ALTER COLUMN "customer_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "source" "ride_source" DEFAULT 'dispatch' NOT NULL;