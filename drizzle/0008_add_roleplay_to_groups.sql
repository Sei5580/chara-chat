ALTER TABLE `groups` ADD COLUMN `roleplay_character_id` integer;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `roleplay_continue` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_messages` ADD COLUMN `user_authored` integer DEFAULT 0 NOT NULL;
