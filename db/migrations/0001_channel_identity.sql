ALTER TABLE "contact" ADD COLUMN "platform_contact_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "platform_thread_id" text;--> statement-breakpoint
CREATE INDEX "contact_account_id_idx" ON "contact" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_account_platform_id_key" UNIQUE("account_id","platform_contact_id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_channel_thread_id_key" UNIQUE("channel_id","platform_thread_id");