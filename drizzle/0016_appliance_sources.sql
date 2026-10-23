ALTER TABLE "appliances" ADD COLUMN "sources" jsonb DEFAULT '{}'::jsonb NOT NULL;
