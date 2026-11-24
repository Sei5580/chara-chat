// キャラチャット — データモデル（設計書 v1.3 7章）
//
// categories: キャラのカテゴリ分類。1キャラに複数カテゴリを設定できる（v1.25）。
// character_categories: キャラとカテゴリの多対多の中間テーブル。
// characters: 取り込んだキャラクター。設定本文と「関係・呼び方」は分離して保持する。
// messages: 1対1の会話ログ。seq はキャラごとの単調増加連番（カウンタは characters.next_seq）。
// groups / group_members / group_messages: グループチャットと掛け合いログ。
// reply_requests: 合図（返信リクエスト）の状態機械。pending/processing/done/failed/cancelled。
// meta: 仲介キックの抑制など単一行の設定。

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const characters = sqliteTable("characters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  settingsText: text("settings_text").notNull(),
  relationText: text("relation_text").notNull().default(""),
  sourceJson: text("source_json").notNull().default(""),
  sourceProfileId: text("source_profile_id"),
  imageBlobKey: text("image_blob_key"),
  themeColor: text("theme_color").notNull().default(""),
  nextSeq: integer("next_seq").notNull().default(1),
  // 未読管理（設計書 v1.5 / 4.5章）: 利用者がこの会話を最後に開いた時点で
  // 既読になった最大 seq。seq がこれより大きいキャラ発言が未読。
  lastReadSeq: integer("last_read_seq").notNull().default(0),
  // 旧カテゴリ分類（v1.8）: 単一カテゴリ時代のカラム。v1.25 で多対多へ移行し、
  // 正は character_categories 側になった。このカラムは移行元として残すが、
  // 新規の読み書きは character_categories を使う（互換のため先頭カテゴリを同期する）。
  categoryId: integer("category_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// キャラとカテゴリの多対多（v1.25）: 1キャラが複数カテゴリに属せる。
// カテゴリA・B両方に登録されたキャラは、Aで絞り込んでもBで絞り込んでも現れる。
export const characterCategories = sqliteTable(
  "character_categories",
  {
    characterId: integer("character_id").notNull(),
    categoryId: integer("category_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.categoryId] })],
);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterId: integer("character_id").notNull(),
  speaker: text("speaker", { enum: ["user", "character"] }).notNull(),
  body: text("body").notNull(),
  seq: integer("seq").notNull(),
  requestId: integer("request_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "dissolved"] })
    .notNull()
    .default("active"),
  nextSeq: integer("next_seq").notNull().default(1),
  // 未読管理（設計書 v1.5 / 4.5章）: characters.last_read_seq と同じ意味。
  lastReadSeq: integer("last_read_seq").notNull().default(0),
  // なりきり（v1.19）: 利用者がなりきる参加キャラのID。未設定は null。
  roleplayCharacterId: integer("roleplay_character_id"),
  // 「なりきりキャラの台詞」設定（v1.19 で追加、v1.20 で意味を再定義）:
  // 1 = 「AIも演じる」（AIが返信し、なりきりキャラの台詞もAIが書いて続ける）、
  // 0 = 「自分だけが演じる」（AIは他のキャラだけで返信し、なりきりキャラの
  // 台詞は書かない）。どちらの値でも、利用者が発言したらAIは返信する。
  // 旧値の対応: 旧「会話を続ける」(1) → 「AIも演じる」、旧「入力を待つ」(0)
  // → 「自分だけが演じる」。値そのものは従来通りで、そのまま引き継がれる。
  roleplayContinue: integer("roleplay_continue").notNull().default(0),
  // ゲスト・モブ（v1.24）: 1 の時、生成で参加者以外のキャラクター（ゲスト）や
  // 名前のない一般の人々（モブ）が、場面に応じて会話に混じることがある。
  // 混じらないこともある。既定はどちらも 0（従来通り参加者だけ）。
  allowGuests: integer("allow_guests").notNull().default(0),
  allowMobs: integer("allow_mobs").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const groupMembers = sqliteTable("group_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  characterId: integer("character_id").notNull(),
});

export const groupMessages = sqliteTable("group_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  kind: text("kind", { enum: ["user", "character", "raw"] }).notNull(),
  characterId: integer("character_id"),
  speakerName: text("speaker_name").notNull().default(""),
  body: text("body").notNull(),
  seq: integer("seq").notNull(),
  requestId: integer("request_id"),
  // なりきり発言（v1.19）: kind="character" でも利用者本人が書いた発言は 1。
  // AI生成の発言と区別して色を変えて表示するために使う。
  userAuthored: integer("user_authored").notNull().default(0),
  splitStatus: text("split_status", { enum: ["normal", "abnormal"] })
    .notNull()
    .default("normal"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const replyRequests = sqliteTable("reply_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetKind: text("target_kind", { enum: ["chat", "group"] }).notNull(),
  targetId: integer("target_id").notNull(),
  uptoSeq: integer("upto_seq").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  failReason: text("fail_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

// レビュー（設計書 v1.5 / 4.4章）: 特定のキャラ発言への指摘。状態は
// pending / processing / done（自動適用済み）/ no_change（変更なし）/ failed。
// message_body は発言が削除されても履歴が読めるよう登録時の複写を保持する。
export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterId: integer("character_id").notNull(),
  targetKind: text("target_kind", { enum: ["chat", "group"] }).notNull(),
  targetId: integer("target_id").notNull(),
  messageId: integer("message_id").notNull(),
  messageBody: text("message_body").notNull(),
  feedback: text("feedback").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "done", "no_change", "failed"],
  })
    .notNull()
    .default("pending"),
  failReason: text("fail_reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

// 設定改訂（設計書 v1.5）: レビュー見直しの自動適用の記録。変更前JSONを保持し、
// 取り消し（reverted_at）でその改訂の変更前JSONへ戻せる。diff は
// [{ path, before, after }] のJSON文字列（値は表示用に文字列化済みの場合がある）。
export const settingRevisions = sqliteTable("setting_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  characterId: integer("character_id").notNull(),
  reviewId: integer("review_id").notNull(),
  beforeJson: text("before_json").notNull(),
  afterJson: text("after_json").notNull(),
  diff: text("diff").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  revertedAt: integer("reverted_at", { mode: "timestamp_ms" }),
});

// 戻し下書き（設計書 v1.4）: リクエストが failed に確定した時、対象だった利用者発言を
// ログから削除し、その本文（時系列順・改行連結）と失敗理由を対象ごとに最大1件保持する。
// 新しい発言が投稿された時点で消去される。
export const drafts = sqliteTable(
  "drafts",
  {
    targetKind: text("target_kind", { enum: ["chat", "group"] }).notNull(),
    targetId: integer("target_id").notNull(),
    body: text("body").notNull().default(""),
    failReason: text("fail_reason").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.targetKind, t.targetId] })],
);
