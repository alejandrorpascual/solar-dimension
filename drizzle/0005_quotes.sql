CREATE TABLE "quote_settings" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"musts" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_settings_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"vendor_label" text,
	"file_name" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"pages" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"model_used" text,
	"usage" jsonb,
	"extraction" jsonb,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_override" double precision,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('queued', 'processing', 'ready', 'needs_review', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "quote_settings" ADD CONSTRAINT "quote_settings_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_user_project_idx" ON "quotes" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");