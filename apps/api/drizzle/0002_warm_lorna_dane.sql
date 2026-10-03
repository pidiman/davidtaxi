ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seats" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "body_type" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fuel" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vin" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "stk_until" date;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "ek_until" date;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "insurance_until" date;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "note" text;