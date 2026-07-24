CREATE TABLE `assessment_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`subject` text NOT NULL,
	`assessment_index` integer NOT NULL,
	`level` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_levels_student_subject_item_idx` ON `assessment_levels` (`student_id`,`subject`,`assessment_index`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_number_idx` ON `students` (`number`);
--> statement-breakpoint
INSERT OR IGNORE INTO `students` (`id`, `number`, `name`, `active`, `created_at`) VALUES
(1, 1, '김도윤', 1, '2026-07-24T00:00:00.000Z'),
(2, 2, '이서아', 1, '2026-07-24T00:00:00.000Z'),
(3, 3, '박지후', 1, '2026-07-24T00:00:00.000Z'),
(4, 4, '최하린', 1, '2026-07-24T00:00:00.000Z'),
(5, 5, '정시우', 1, '2026-07-24T00:00:00.000Z'),
(6, 6, '한예준', 1, '2026-07-24T00:00:00.000Z'),
(7, 7, '윤서윤', 1, '2026-07-24T00:00:00.000Z'),
(8, 8, '강민재', 1, '2026-07-24T00:00:00.000Z'),
(9, 9, '조유나', 1, '2026-07-24T00:00:00.000Z'),
(10, 10, '임도현', 1, '2026-07-24T00:00:00.000Z'),
(11, 11, '신채원', 1, '2026-07-24T00:00:00.000Z'),
(12, 12, '오준서', 1, '2026-07-24T00:00:00.000Z'),
(13, 13, '서지아', 1, '2026-07-24T00:00:00.000Z'),
(14, 14, '권하준', 1, '2026-07-24T00:00:00.000Z'),
(15, 15, '황수빈', 1, '2026-07-24T00:00:00.000Z'),
(16, 16, '송지호', 1, '2026-07-24T00:00:00.000Z'),
(17, 17, '안다은', 1, '2026-07-24T00:00:00.000Z'),
(18, 18, '류건우', 1, '2026-07-24T00:00:00.000Z'),
(19, 19, '전소율', 1, '2026-07-24T00:00:00.000Z'),
(20, 20, '홍현우', 1, '2026-07-24T00:00:00.000Z'),
(21, 21, '문예린', 1, '2026-07-24T00:00:00.000Z'),
(22, 22, '배도경', 1, '2026-07-24T00:00:00.000Z'),
(23, 23, '백나윤', 1, '2026-07-24T00:00:00.000Z'),
(24, 24, '남태윤', 1, '2026-07-24T00:00:00.000Z'),
(25, 25, '노가은', 1, '2026-07-24T00:00:00.000Z');
