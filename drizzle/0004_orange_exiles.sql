CREATE TABLE `classrooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`school_name` text NOT NULL,
	`school_year` integer NOT NULL,
	`semester` integer NOT NULL,
	`grade` integer NOT NULL,
	`class_number` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classrooms_owner_period_idx` ON `classrooms` (`owner_email`,`school_year`,`semester`,`grade`,`class_number`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `assessment_levels_student_subject_item_idx`;--> statement-breakpoint
ALTER TABLE `assessment_levels` ADD `owner_email` text DEFAULT '__legacy__' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_levels` ADD `class_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_levels_student_subject_item_idx` ON `assessment_levels` (`class_id`,`student_id`,`subject`,`assessment_index`);--> statement-breakpoint
DROP INDEX `assessment_plans_content_idx`;--> statement-breakpoint
ALTER TABLE `assessment_plans` ADD `owner_email` text DEFAULT '__template__' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_plans` ADD `class_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_plans_content_idx` ON `assessment_plans` (`class_id`,`subject`,`unit`,`goal`);--> statement-breakpoint
DROP INDEX `generated_comments_student_subject_idx`;--> statement-breakpoint
ALTER TABLE `generated_comments` ADD `owner_email` text DEFAULT '__legacy__' NOT NULL;--> statement-breakpoint
ALTER TABLE `generated_comments` ADD `class_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `generated_comments_student_subject_idx` ON `generated_comments` (`class_id`,`student_id`,`subject`);--> statement-breakpoint
DROP INDEX `student_behaviors_student_idx`;--> statement-breakpoint
ALTER TABLE `student_behaviors` ADD `owner_email` text DEFAULT '__legacy__' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_behaviors` ADD `class_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `student_behaviors_student_idx` ON `student_behaviors` (`class_id`,`student_id`);--> statement-breakpoint
DROP INDEX `students_number_idx`;--> statement-breakpoint
ALTER TABLE `students` ADD `owner_email` text DEFAULT '__template__' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `class_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `students_number_idx` ON `students` (`class_id`,`number`);