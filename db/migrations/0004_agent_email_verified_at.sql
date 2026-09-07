ALTER TABLE "agent" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Agents that existed before self-serve signup (M4) were created by the seed
-- script or a direct insert and are trusted. Grandfather them as verified so
-- the check added to login does not lock them out.
UPDATE "agent" SET "email_verified_at" = now() WHERE "email_verified_at" IS NULL;
