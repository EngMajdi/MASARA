CREATE TABLE `eta_accuracy_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`bus_id` text NOT NULL,
	`stop_id` text NOT NULL,
	`prediction_timestamp` integer NOT NULL,
	`prediction_bucket_at` integer NOT NULL,
	`predicted_arrival_at` integer NOT NULL,
	`confidence` text NOT NULL,
	`prediction_source` text NOT NULL,
	`actual_arrival_at` integer,
	`actual_source` text,
	`signed_error_seconds` real,
	`absolute_error_seconds` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bus_id`) REFERENCES `buses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stop_id`) REFERENCES `route_stops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eta_accuracy_trip_stop_bucket_unique` ON `eta_accuracy_observations` (`trip_id`,`stop_id`,`prediction_bucket_at`);--> statement-breakpoint
CREATE INDEX `eta_accuracy_trip_idx` ON `eta_accuracy_observations` (`trip_id`);--> statement-breakpoint
CREATE INDEX `eta_accuracy_bus_idx` ON `eta_accuracy_observations` (`bus_id`);--> statement-breakpoint
CREATE INDEX `eta_accuracy_pending_idx` ON `eta_accuracy_observations` (`trip_id`,`actual_arrival_at`);