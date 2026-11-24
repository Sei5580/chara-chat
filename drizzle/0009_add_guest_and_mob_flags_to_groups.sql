ALTER TABLE `groups` ADD COLUMN `allow_guests` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `allow_mobs` integer DEFAULT 0 NOT NULL;
