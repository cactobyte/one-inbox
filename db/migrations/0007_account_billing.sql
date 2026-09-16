ALTER TABLE "account" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "subscription_status" text;