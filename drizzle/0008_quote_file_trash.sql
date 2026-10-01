CREATE TABLE "quote_file_trash" (
	"pathname" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
