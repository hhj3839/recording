CREATE TABLE `generated_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`subject` text NOT NULL,
	`comment` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_comments_student_subject_idx` ON `generated_comments` (`student_id`,`subject`);