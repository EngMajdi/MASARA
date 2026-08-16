ALTER TABLE `audit_logs` ADD `trip_id` text REFERENCES trips(id);--> statement-breakpoint
CREATE INDEX `audit_logs_trip_idx` ON `audit_logs` (`trip_id`,`created_at`);