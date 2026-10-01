CREATE TABLE "quote_usage" (
	"user_id" text NOT NULL,
	"month" date NOT NULL,
	"uploads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_usage_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
ALTER TABLE "quote_usage" ADD CONSTRAINT "quote_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;