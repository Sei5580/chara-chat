ALTER TABLE `reply_requests` ADD COLUMN `fail_detail` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reply_requests` ADD COLUMN `kick_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reply_requests` ADD COLUMN `last_kick_at` integer;
--> statement-breakpoint
ALTER TABLE `reviews` ADD COLUMN `fail_detail` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reviews` ADD COLUMN `kick_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reviews` ADD COLUMN `last_kick_at` integer;
