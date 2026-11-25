ALTER TABLE `messages` ADD COLUMN `is_topic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `topic_source` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_messages` ADD COLUMN `is_topic` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_messages` ADD COLUMN `topic_source` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `characters` ADD COLUMN `auto_topic_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `characters` ADD COLUMN `auto_topic_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `auto_topic_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `auto_topic_count` integer DEFAULT 0 NOT NULL;
