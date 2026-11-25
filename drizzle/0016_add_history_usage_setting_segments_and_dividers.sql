ALTER TABLE `characters` ADD COLUMN `use_history` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `characters` ADD COLUMN `history_boundary_seq` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `characters` ADD COLUMN `current_segment_no` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `use_history` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `history_boundary_seq` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `current_segment_no` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `no_history` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `segment_no` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_messages` ADD COLUMN `no_history` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_messages` ADD COLUMN `segment_no` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reply_requests` ADD COLUMN `no_history` integer DEFAULT 0 NOT NULL;
