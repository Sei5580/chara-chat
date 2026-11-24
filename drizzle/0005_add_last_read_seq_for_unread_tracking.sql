ALTER TABLE `characters` ADD COLUMN `last_read_seq` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `last_read_seq` integer DEFAULT 0 NOT NULL;
