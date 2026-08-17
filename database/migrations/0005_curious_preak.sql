CREATE TABLE `current_location_projection` (
	`bus_id` text PRIMARY KEY NOT NULL,
	`trip_id` text,
	`observation_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`source` text NOT NULL,
	`sequence` integer,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`speed_kmh` real,
	`heading` real,
	`accuracy_meters` real,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bus_id`) REFERENCES `buses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `current_location_projection_trip_idx` ON `current_location_projection` (`trip_id`);