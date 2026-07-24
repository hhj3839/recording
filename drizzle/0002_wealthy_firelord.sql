CREATE TABLE `student_behaviors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`characteristic` text NOT NULL,
	`behavior` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_behaviors_student_idx` ON `student_behaviors` (`student_id`);