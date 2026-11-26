CREATE TABLE `reviews_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `character_id` integer NOT NULL,
  `target_kind` text NOT NULL,
  `target_id` integer NOT NULL,
  `message_id` integer,
  `message_body` text NOT NULL,
  `feedback` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `fail_reason` text DEFAULT '' NOT NULL,
  `fail_detail` text DEFAULT '' NOT NULL,
  `kick_count` integer DEFAULT 0 NOT NULL,
  `last_kick_at` integer,
  `created_at` integer NOT NULL,
  `started_at` integer,
  `finished_at` integer
);
--> statement-breakpoint
INSERT INTO `reviews_new` (`id`, `character_id`, `target_kind`, `target_id`, `message_id`, `message_body`, `feedback`, `status`, `fail_reason`, `fail_detail`, `kick_count`, `last_kick_at`, `created_at`, `started_at`, `finished_at`)
SELECT `id`, `character_id`, `target_kind`, `target_id`, `message_id`, `message_body`, `feedback`, `status`, `fail_reason`, `fail_detail`, `kick_count`, `last_kick_at`, `created_at`, `started_at`, `finished_at` FROM `reviews`;
--> statement-breakpoint
DROP TABLE `reviews`;
--> statement-breakpoint
ALTER TABLE `reviews_new` RENAME TO `reviews`;
