CREATE TABLE `legacy_login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_login_attempts_email_unique` ON `legacy_login_attempts` (`email`);--> statement-breakpoint
CREATE TABLE `legacy_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_sessions_token_hash_unique` ON `legacy_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `legacy_sessions_user_id_idx` ON `legacy_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `legacy_sessions_expires_at_idx` ON `legacy_sessions` (`expires_at`);