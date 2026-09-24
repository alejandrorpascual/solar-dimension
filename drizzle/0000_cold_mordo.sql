CREATE TABLE "projects" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"qty" jsonb NOT NULL,
	"custom" jsonb NOT NULL,
	"hours" integer NOT NULL,
	"volts" integer NOT NULL,
	"chemistry" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_user_id_id_pk" PRIMARY KEY("user_id","id")
);
