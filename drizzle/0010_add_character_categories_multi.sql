CREATE TABLE `character_categories` (
	`character_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`character_id`, `category_id`)
);
--> statement-breakpoint
INSERT INTO `character_categories` (`character_id`, `category_id`) SELECT `id`, `category_id` FROM `characters` WHERE `category_id` IS NOT NULL;
