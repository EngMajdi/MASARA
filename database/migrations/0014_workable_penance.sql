ALTER TABLE `students` ADD `legacy_student_id` text REFERENCES legacy_students(id);--> statement-breakpoint
CREATE UNIQUE INDEX `students_legacy_student_unique` ON `students` (`legacy_student_id`);