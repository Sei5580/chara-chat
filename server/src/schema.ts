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
  // 差分取り込み: 取り込み時点における取り込み元プロファイルの updated_at
  // （ISO文字列）。次回取り込み時に元側の updated_at と突き合わせ、新しい
  // 場合だけ再取り込みする。null は未記録（この仕組みより前の取り込み分）で、
  // 「変更あり」として一度だけ取り込み直し、その際に記録される。
  sourceUpdatedAt: text("source_updated_at"),
  imageBlobKey: text("image_blob_key"),
  themeColor: text("theme_color").notNull().default(""),
  nextSeq: integer("next_seq").notNull().default(1),
  // 未読管理（設計書 v1.5 / 4.5章）: 利用者がこの会話を最後に開いた時点で
  // 既読になった最大 seq。seq がこれより大きいキャラ発言が未読。
  lastReadSeq: integer("last_read_seq").notNull().default(0),
  // 履歴の使用設定（設計書 v3.2）: 1 = 生成の文脈に過去の履歴を含める（従来通り）、
  // 0 = 一切含めない。グループにも同じ3カラムがある。
  useHistory: integer("use_history").notNull().default(1),
  // 履歴の境界（設計書 v3.2）: 「使わない」へ切り替えた時点の最大 seq。
  // 「使う」の時でも、参照できるのは seq がこれより大きい発言だけ。
  // 「使う」へ戻しても境界は動かず、再度「使わない」にした時だけ更新される。
  historyBoundarySeq: integer("history_boundary_seq").notNull().default(0),
  // 区間（設計書 v3.2 追補）: 現在の区間番号。チャット作成時は 1 で、
  // 「使わない」へ切り替えるたびに +1 され新しい区間が始まる（「使う」へ
  // 戻しても区間は分かれない）。各発言は segment_no に所属区間を保持する。
  currentSegmentNo: integer("current_segment_no").notNull().default(1),
  // 旧カテゴリ分類（v1.8）: 単一カテゴリ時代のカラム。v1.25 で多対多へ移行し、
  // 正は character_categories 側になった。読み側の旧カラムフォールバックと
  // 書き側の先頭カテゴリ同期は廃止済み（実データの一致を検証した上で停止）。
  // このカラムは移行元として値を保持するだけで、読み書きは一切されない。
  categoryId: integer("category_id"),
  // 自動議題（ローカル改善: 上流リポジトリには無い）: 会話が一区切りして
  // 入力待ちのまま30分動きが無い時、ランダムな議題を自動投稿する設定
  // （既定オフ）と、利用者の発言が無いまま自動投稿した連続回数
  // （上限3回で停止し、利用者が発言すると0に戻る）。
  autoTopicEnabled: integer("auto_topic_enabled").notNull().default(0),
  autoTopicCount: integer("auto_topic_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // 階層化（v1.26）: 親カテゴリのID。null は最上位。深さは無制限。
  // 自分自身や自分の子孫を親にすることはできない（循環防止、サーバ側で検証）。
  parentId: integer("parent_id"),
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
  // 「自動」の議題の投稿（ローカル改善#6、旧称: 自動議題）: 1 の発言は
  // 「自動」の議題として表示する。
  // speaker は "user" のままなので、返信生成の対象判定は従来どおり。
  // topic_source は議題の出所: "news"（時事ネタ）/ "interest"（キャラの
  // 興味）/ "muse"（Muse上での出来事）/ "context"（会話の流れ）/
  // "profile"（プロフィール由来）/ "season"（季節・今日は何の日）/
  // "hypothetical"（もしも・二択）/ "contrast"（キャラ同士の対比）。
  // 通常発言は ""。
  isTopic: integer("is_topic").notNull().default(0),
  topicSource: text("topic_source").notNull().default(""),
  seq: integer("seq").notNull(),
  requestId: integer("request_id"),
  // 区切り線（設計書 v3.2）: 履歴を使わずに生成された返信は 1。その発言の
  // 直前に区切り線（その区間で最初に生成された掛け合いの生成日つき）を表示する。
  // 生成バッチの先頭発言だけに付き、後から設定を変えても変わらない。
  noHistory: integer("no_history").notNull().default(0),
  // 区間（設計書 v3.2 追補）: この発言が属する区間番号（characters.current_segment_no
  // の発言時点の値）。将来の区間ごとの表示・非表示切り替えのために保持する。
  // 例外: 履歴なし生成のきっかけになった利用者発言は、生成の保存時に返信と
  // 同じ区間へ付け替える（区切りはその発言の前に置かれる）。
  segmentNo: integer("segment_no").notNull().default(1),
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
  // 自動議題（ローカル改善）: characters 側と同じ意味。既定オフ、
  // 連続自動投稿は上限3回で停止し、利用者が発言すると0に戻る。
  autoTopicEnabled: integer("auto_topic_enabled").notNull().default(0),
  autoTopicCount: integer("auto_topic_count").notNull().default(0),
  // ナレーション（設計書 v3.1）: 1 の時、生成で会話の背景説明・場面転換・
  // 時間経過の説明（ナレーション）が入ることがある。誰かの台詞ではなく、
  // 次の会話までに起きた事をただ記載する。既定は 0（従来通り入れない）。
  allowNarration: integer("allow_narration").notNull().default(0),
  // 背景情報（設計書 v2.0 / C）: グループの生成（通常・自動の両方）の
  // システムプロンプトへ「背景情報」セクションとして常時含める自由文。
  // 一度書けば使われ続ける。1対1には含めない。
  backgroundText: text("background_text").notNull().default(""),
  // 履歴の使用設定・境界・区間（設計書 v3.2）: characters と同じ意味。
  useHistory: integer("use_history").notNull().default(1),
  historyBoundarySeq: integer("history_boundary_seq").notNull().default(0),
  currentSegmentNo: integer("current_segment_no").notNull().default(1),
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
  // kind="narration"（設計書 v3.1）: ナレーション。発言者（キャラ）を持たず
  // character_id は null、speaker_name は空。表示は吹き出しではなく中央揃えの
  // システムメッセージ形式。未読・新着の扱いは character と同じ。
  kind: text("kind", { enum: ["user", "character", "raw", "narration"] }).notNull(),
  characterId: integer("character_id"),
  speakerName: text("speaker_name").notNull().default(""),
  body: text("body").notNull(),
  seq: integer("seq").notNull(),
  requestId: integer("request_id"),
  // なりきり発言（v1.19）: kind="character" でも利用者本人が書いた発言は 1。
  // AI生成の発言と区別して色を変えて表示するために使う。
  userAuthored: integer("user_authored").notNull().default(0),
  // 「自動」の議題の投稿（ローカル改善#6）: 1 の発言は「自動」の議題として表示する。
  // kind は "user" のままなので、掛け合い生成の対象判定は従来どおり。
  // topic_source の意味は messages 側と同じ。通常の話題・指示は ""。
  isTopic: integer("is_topic").notNull().default(0),
  topicSource: text("topic_source").notNull().default(""),
  // 区切り線と区間（設計書 v3.2）: messages と同じ意味（履歴なし生成の
  // きっかけになった利用者発言の区間付け替えを含む）。no_history は
  // 履歴を使わずに生成された掛け合いの先頭の発言だけ 1。
  noHistory: integer("no_history").notNull().default(0),
  segmentNo: integer("segment_no").notNull().default(1),
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
  // 発生源（設計書 v2.0 / B）: manual = 利用者の発言への通常返信、
  // auto = スケジューリングの自動生成。auto は送信取り消し・戻し下書きの
  // 対象外で、生成の優先順位は manual の後（getWorkItems の並びで末尾）。
  origin: text("origin", { enum: ["manual", "auto"] }).notNull().default("manual"),
  // auto の時、発火したスケジュールのID（schedules.id）。成功時に
  // schedules.last_group_id の更新や自動生成ログの記録に使う。
  scheduleId: integer("schedule_id"),
  // 履歴なし生成（設計書 v3.2）: getWorkItems が材料を組み立てた時点で、
  // その生成が過去の履歴を含まない場合は 1 を記録する。completeRequest は
  // これを見て、保存する発言群の先頭に区切り線の印（no_history）を付ける。
  noHistory: integer("no_history").notNull().default(0),
  status: text("status", {
    enum: ["pending", "processing", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  failReason: text("fail_reason").notNull().default(""),
  // 失敗の詳細（ローカル改善: 上流リポジトリには無い）: 理由コードだけでは
  // 原因を追えないため、生成コマンドの終了コードやエラー出力の末尾などを
  // 仲介が failRequest の detail で渡し、ここへ原文のまま残す。サーバ側で
  // 確定した失敗（タイムアウト等）も、その経緯をここへ書く。
  failDetail: text("fail_detail").notNull().default(""),
  // pending 放置の見張り（ローカル改善）: pending のまま開始されない
  // リクエストは、見張りが仲介を叩き直した回数と最終の叩き直し時刻を
  // ここに記録し、上限まで叩き直しても始まらなければ failed に確定する。
  kickCount: integer("kick_count").notNull().default(0),
  lastKickAt: integer("last_kick_at", { mode: "timestamp_ms" }),
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
  // 失敗の詳細と pending 放置の見張り（ローカル改善）: reply_requests 側と同じ意味。
  failDetail: text("fail_detail").notNull().default(""),
  kickCount: integer("kick_count").notNull().default(0),
  lastKickAt: integer("last_kick_at", { mode: "timestamp_ms" }),
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

// スケジューリング（設計書 v2.0 / B・E）: 自動生成のスケジュール。複数作成でき、
// それぞれ名前を持つ。対象は既存グループ（target_type="existing"、そのグループの
// 設定を参照して会話を生成・更新する）か、毎回新規チャット（target_type="new"、
// カテゴリからランダム抽選してグループを作成する）。
// weekdays / times / category_ids は JSON 文字列で保持する
// （weekdays: 0=日曜〜6=土曜の配列、times: "HH:MM" の配列）。
// last_fired_slot は JST の "YYYY-MM-DD HH:MM" で、発火・スキップ確定と同時に
// 記録して二重発火と同一スロットの重複スキップログを防ぐ。
// last_group_id は新規チャット型で前回生成したグループ（履歴参照用）。
export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull().default("daily"),
  weekdays: text("weekdays").notNull().default("[]"),
  times: text("times").notNull().default("[]"),
  targetType: text("target_type", { enum: ["existing", "new"] }).notNull().default("existing"),
  targetGroupId: integer("target_group_id"),
  categoryIds: text("category_ids").notNull().default("[]"),
  minMembers: integer("min_members").notNull().default(2),
  maxMembers: integer("max_members").notNull().default(4),
  allowGuests: integer("allow_guests").notNull().default(0),
  allowMobs: integer("allow_mobs").notNull().default(0),
  // ナレーション（設計書 v3.1）: 新規チャット型でのみ意味を持ち、作成される
  // グループの allow_narration へ引き継ぐ。既存グループ型はグループ側の設定に従う。
  allowNarration: integer("allow_narration").notNull().default(0),
  // 旧「履歴を使う」設定（v2.0）: 設計書 v3.2 でスケジュール側の選択肢は廃止され、
  // 履歴の使用設定はチャット／グループ側へ移った（新規チャット型は毎回まっさら、
  // 既存グループ型はグループ自身の設定に従う）。DB の use_history カラムは
  // 移行時点の値を保持するだけで、読み書きは一切されない（characters.category_id
  // と同じ扱い）。
  // 新規チャット型でのみ意味を持つ背景情報（スケジュール側が正）。
  // 作成グループへは初期値としてコピーする（逆流はしない）。
  backgroundText: text("background_text").notNull().default(""),
  lastFiredSlot: text("last_fired_slot"),
  lastGroupId: integer("last_group_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 全体ログ（設計書 v2.0 / D）: 利用者の送信・生成のプロンプトと生レスポンス・
// レビュー・キャラ設定変更・自動生成の記録。保持は全種別合算で最新100件
// （挿入時に超過分を古い順に削除する）。一覧は見出しのみを返し、本文は
// 開閉時に個別取得する。
export const appLogs = sqliteTable("app_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["user_send", "generation", "review", "settings", "auto"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  relatedType: text("related_type"),
  relatedId: integer("related_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
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
