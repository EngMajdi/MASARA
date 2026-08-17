CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`trip_id` text NOT NULL,
	`state` text DEFAULT 'scheduled' NOT NULL,
	`current_stop_id` text,
	`scheduled_pickup_time` integer,
	`scheduled_dropoff_time` integer,
	`boarded_at` integer,
	`dropped_off_at` integer,
	`missed_reason` text,
	`cancel_reason` text,
	`incident_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_stop_id`) REFERENCES `route_stops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journeys_student_trip_unique` ON `journeys` (`student_id`,`trip_id`);--> statement-breakpoint
CREATE INDEX `journeys_student_idx` ON `journeys` (`student_id`);--> statement-breakpoint
CREATE INDEX `journeys_trip_idx` ON `journeys` (`trip_id`);--> statement-breakpoint
CREATE INDEX `journeys_state_idx` ON `journeys` (`state`);--> statement-breakpoint
CREATE INDEX `journeys_trip_state_idx` ON `journeys` (`trip_id`,`state`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `student_id` text REFERENCES students(id);--> statement-breakpoint
CREATE INDEX `audit_logs_student_idx` ON `audit_logs` (`student_id`,`created_at`);