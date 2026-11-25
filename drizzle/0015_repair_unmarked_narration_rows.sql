UPDATE `group_messages`
SET `kind` = 'narration', `split_status` = 'normal'
WHERE `kind` = 'raw'
  AND `group_id` IN (SELECT `id` FROM `groups` WHERE `allow_narration` = 1)
  AND instr(`body`, '：') = 0
  AND instr(`body`, ':') = 0
  AND length(`body`) <= 200;
