CREATE TYPE "public"."incident_kind" AS ENUM('incident', 'comment');--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "kind" "incident_kind" DEFAULT 'incident' NOT NULL;