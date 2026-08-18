CREATE TABLE `user_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`verified_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_contacts_user_channel_value_unique` ON `user_contacts` (`user_id`,`channel`,`normalized_value`);--> statement-breakpoint
CREATE INDEX `user_contacts_user_idx` ON `user_contacts` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_contacts_user_channel_idx` ON `user_contacts` (`user_id`,`channel`);