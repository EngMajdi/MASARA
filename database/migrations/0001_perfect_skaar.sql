ALTER TABLE `ai_recommendations` ADD `bus_id` text REFERENCES buses(id);--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `source_route_id` text REFERENCES routes(id);--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `type` text NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `title` text NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `confidence` real NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `expected_outcome` text;--> statement-breakpoint
ALTER TABLE `ai_recommendations` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `ai_recommendations_trip_status_idx` ON `ai_recommendations` (`trip_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_recommendations_status_idx` ON `ai_recommendations` (`status`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `event_type` text DEFAULT 'AGENT_RUN' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_type` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `entity_type` text DEFAULT 'ai_recommendation' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `entity_id` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `previous_state` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `new_state` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `metadata` text;--> statement-breakpoint
CREATE INDEX `audit_logs_recommendation_idx` ON `audit_logs` (`recommendation_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);