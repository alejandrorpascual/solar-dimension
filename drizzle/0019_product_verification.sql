ALTER TABLE "products" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "verified_by" text;