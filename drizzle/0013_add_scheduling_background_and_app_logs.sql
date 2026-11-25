ALTER TABLE `groups` ADD COLUMN `background_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reply_requests` ADD COLUMN `origin` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reply_requests` ADD COLUMN `schedule_id` integer;
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`times` text DEFAULT '[]' NOT NULL,
	`target_type` text DEFAULT 'existing' NOT NULL,
	`target_group_id` integer,
	`category_ids` text DEFAULT '[]' NOT NULL,
	`min_members` integer DEFAULT 2 NOT NULL,
	`max_members` integer DEFAULT 4 NOT NULL,
	`allow_guests` integer DEFAULT 0 NOT NULL,
	`allow_mobs` integer DEFAULT 0 NOT NULL,
	`use_history` integer DEFAULT 0 NOT NULL,
	`background_text` text DEFAULT '' NOT NULL,
	`last_fired_slot` text,
	`last_group_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`related_type` text,
	`related_id` integer,
	`created_at` integer NOT NULL
);
