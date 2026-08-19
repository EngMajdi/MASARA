ALTER TABLE `user_contacts` ADD `verification_code_hash` text;--> statement-breakpoint
ALTER TABLE `user_contacts` ADD `verification_expires_at` integer;