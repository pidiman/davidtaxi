CREATE TYPE "public"."km_source" AS ENUM('driver', 'next_driver', 'admin');--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"vehicle_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"schedule_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"start_km" integer NOT NULL,
	"end_km" integer,
	"end_km_source" "km_source",
	"note" text
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "photo" "bytea";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "photo_mime" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_time_idx" ON "schedules" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "shifts_vehicle_idx" ON "shifts" USING btree ("vehicle_id","started_at");--> statement-breakpoint
CREATE INDEX "shifts_driver_idx" ON "shifts" USING btree ("driver_id");--> statement-breakpoint
-- vodiči odteraz potrebujú smenu s vybraným autom → všetkých odhlásiť zo starého režimu
UPDATE "users" SET "driver_status" = 'offline', "vehicle_id" = NULL WHERE "role" = 'driver';
