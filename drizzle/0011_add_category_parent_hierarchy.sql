ALTER TABLE `categories` ADD COLUMN `parent_id` integer;
--> statement-breakpoint
UPDATE `categories` SET `parent_id` = (SELECT `id` FROM `categories` WHERE `name` = 'ゲーム' LIMIT 1) WHERE `name` = '子カテゴリ例' AND `parent_id` IS NULL AND EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'ゲーム');
