ALTER TABLE `groups` ADD COLUMN `allow_narration` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `schedules` ADD COLUMN `allow_narration` integer DEFAULT 0 NOT NULL;
