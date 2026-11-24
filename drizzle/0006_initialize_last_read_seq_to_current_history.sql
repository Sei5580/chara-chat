UPDATE `characters` SET `last_read_seq` = COALESCE((SELECT MAX(`seq`) FROM `messages` WHERE `messages`.`character_id` = `characters`.`id`), 0);
--> statement-breakpoint
UPDATE `groups` SET `last_read_seq` = COALESCE((SELECT MAX(`seq`) FROM `group_messages` WHERE `group_messages`.`group_id` = `groups`.`id`), 0);
