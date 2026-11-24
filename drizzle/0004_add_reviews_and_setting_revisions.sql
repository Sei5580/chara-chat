CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  character_id INTEGER NOT NULL,
  target_kind TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  message_body TEXT NOT NULL,
  feedback TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fail_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
--> statement-breakpoint
CREATE TABLE setting_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  character_id INTEGER NOT NULL,
  review_id INTEGER NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  diff TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  reverted_at INTEGER
);
