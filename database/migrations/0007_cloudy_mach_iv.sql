CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`student_id` text NOT NULL,
	`journey_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`event_type` text NOT NULL,
	`source_event_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`priority` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`failure_reason` text,
	`sent_at` integer,
	`read_at` integer,
	`failed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_recipient_source_event_unique` ON `notifications` (`recipient_user_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_created_idx` ON `notifications` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_unread_idx` ON `notifications` (`recipient_user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_student_idx` ON `notifications` (`student_id`);