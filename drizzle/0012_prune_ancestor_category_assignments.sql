DELETE FROM `character_categories`
WHERE EXISTS (
  SELECT 1 FROM `character_categories` cc2
  WHERE cc2.`character_id` = `character_categories`.`character_id`
    AND cc2.`category_id` <> `character_categories`.`category_id`
    AND `character_categories`.`category_id` IN (
      WITH RECURSIVE anc(id) AS (
        SELECT `parent_id` FROM `categories` WHERE `id` = cc2.`category_id` AND `parent_id` IS NOT NULL
        UNION ALL
        SELECT c.`parent_id` FROM `categories` c JOIN anc ON c.`id` = anc.id WHERE c.`parent_id` IS NOT NULL
      )
      SELECT id FROM anc
    )
);
--> statement-breakpoint
UPDATE `characters` SET `category_id` = (SELECT MIN(cc.`category_id`) FROM `character_categories` cc WHERE cc.`character_id` = `characters`.`id`)
WHERE EXISTS (SELECT 1 FROM `character_categories` cc WHERE cc.`character_id` = `characters`.`id`)
  AND `category_id` NOT IN (SELECT cc.`category_id` FROM `character_categories` cc WHERE cc.`character_id` = `characters`.`id`);
