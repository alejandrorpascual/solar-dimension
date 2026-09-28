CREATE TABLE "appliances" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"watts" integer NOT NULL,
	"surge" integer NOT NULL,
	"duty" double precision NOT NULL,
	"tons" double precision,
	"ac_type" text,
	"labels" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "appliances_category_check" CHECK ("appliances"."category" in ('Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal')),
	CONSTRAINT "appliances_surge_check" CHECK ("appliances"."surge" >= "appliances"."watts"),
	CONSTRAINT "appliances_duty_check" CHECK ("appliances"."duty" > 0 and "appliances"."duty" <= 1)
);
