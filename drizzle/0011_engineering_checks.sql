ALTER TABLE "appliances" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "appliances" ADD COLUMN "surge_class" text;--> statement-breakpoint
ALTER TABLE "appliances" ADD COLUMN "burst_seconds" double precision;--> statement-breakpoint
ALTER TABLE "appliances" ADD COLUMN "cycles_per_hour" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "duty_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "electrical" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_kind_check" CHECK ("appliances"."kind" is null or "appliances"."kind" in ('continuous', 'cycling', 'momentary'));--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_surge_class_check" CHECK ("appliances"."surge_class" is null or "appliances"."surge_class" in ('inrush', 'motor', 'compressor'));--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_momentary_check" CHECK (("appliances"."kind" is not distinct from 'momentary') = ("appliances"."burst_seconds" is not null and "appliances"."cycles_per_hour" is not null));