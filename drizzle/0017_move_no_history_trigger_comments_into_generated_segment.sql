UPDATE `messages`
SET `segment_no` = (
  SELECT `b`.`segment_no`
  FROM `messages` AS `b`
  WHERE `b`.`character_id` = `messages`.`character_id`
    AND `b`.`no_history` = 1
    AND `b`.`seq` > `messages`.`seq`
  ORDER BY `b`.`seq` ASC
  LIMIT 1
)
WHERE `messages`.`speaker` = 'user'
  AND EXISTS (
    SELECT 1
    FROM `messages` AS `b`
    WHERE `b`.`character_id` = `messages`.`character_id`
      AND `b`.`no_history` = 1
      AND `b`.`seq` > `messages`.`seq`
      AND `b`.`segment_no` <> `messages`.`segment_no`
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `messages` AS `x`
    WHERE `x`.`character_id` = `messages`.`character_id`
      AND `x`.`speaker` = 'character'
      AND `x`.`seq` > `messages`.`seq`
      AND `x`.`seq` < (
        SELECT MIN(`b`.`seq`)
        FROM `messages` AS `b`
        WHERE `b`.`character_id` = `messages`.`character_id`
          AND `b`.`no_history` = 1
          AND `b`.`seq` > `messages`.`seq`
      )
  );
--> statement-breakpoint
UPDATE `group_messages`
SET `segment_no` = (
  SELECT `b`.`segment_no`
  FROM `group_messages` AS `b`
  WHERE `b`.`group_id` = `group_messages`.`group_id`
    AND `b`.`no_history` = 1
    AND `b`.`seq` > `group_messages`.`seq`
  ORDER BY `b`.`seq` ASC
  LIMIT 1
)
WHERE (`group_messages`.`kind` = 'user' OR (`group_messages`.`kind` = 'character' AND `group_messages`.`user_authored` = 1))
  AND EXISTS (
    SELECT 1
    FROM `group_messages` AS `b`
    WHERE `b`.`group_id` = `group_messages`.`group_id`
      AND `b`.`no_history` = 1
      AND `b`.`seq` > `group_messages`.`seq`
      AND `b`.`segment_no` <> `group_messages`.`segment_no`
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `group_messages` AS `x`
    WHERE `x`.`group_id` = `group_messages`.`group_id`
      AND `x`.`seq` > `group_messages`.`seq`
      AND `x`.`seq` < (
        SELECT MIN(`b`.`seq`)
        FROM `group_messages` AS `b`
        WHERE `b`.`group_id` = `group_messages`.`group_id`
          AND `b`.`no_history` = 1
          AND `b`.`seq` > `group_messages`.`seq`
      )
      AND NOT (`x`.`kind` = 'user' OR (`x`.`kind` = 'character' AND `x`.`user_authored` = 1))
  );
