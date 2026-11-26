ALTER TABLE `characters` ADD COLUMN `flavors` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `flavors` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `schedules` ADD COLUMN `flavors` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `groups` SET `flavors` = json_array(trim(`background_text`)) WHERE trim(`background_text`) <> '';
--> statement-breakpoint
UPDATE `schedules` SET `flavors` = json_array(trim(`background_text`)) WHERE trim(`background_text`) <> '';
