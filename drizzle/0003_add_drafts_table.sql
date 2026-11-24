CREATE TABLE drafts (
  target_kind TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  fail_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id)
);
