CREATE TABLE `telemetry_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`bus_id` text NOT NULL,
	`provider_type` text DEFAULT 'DEVICE' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`secret_hash` text NOT NULL,
	`label` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bus_id`) REFERENCES `buses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telemetry_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_event_id` text NOT NULL,
	`device_id` text NOT NULL,
	`bus_id` text NOT NULL,
	`trip_id` text,
	`source` text NOT NULL,
	`event_type` text DEFAULT 'GPS_LOCATION_RECEIVED' NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`speed_kmh` real,
	`heading` real,
	`accuracy_meters` real,
	`sequence` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `telemetry_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bus_id`) REFERENCES `buses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telemetry_observations_device_source_event_unique` ON `telemetry_observations` (`device_id`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `telemetry_observations_device_occurred_idx` ON `telemetry_observations` (`device_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `telemetry_observations_bus_occurred_idx` ON `telemetry_observations` (`bus_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `telemetry_observations_trip_occurred_idx` ON `telemetry_observations` (`trip_id`,`occurred_at`);