DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  settings_text TEXT NOT NULL,
  relation_text TEXT NOT NULL DEFAULT '',
  source_json TEXT NOT NULL DEFAULT '',
  source_profile_id TEXT,
  image_blob_key TEXT,
  theme_color TEXT NOT NULL DEFAULT '',
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  body TEXT NOT NULL,
  seq INTEGER NOT NULL,
  request_id INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  character_id INTEGER,
  speaker_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  seq INTEGER NOT NULL,
  request_id INTEGER,
  split_status TEXT NOT NULL DEFAULT 'normal',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE reply_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  upto_seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  fail_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
--> statement-breakpoint
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
