// キャラチャット: 1件の生成ジョブを実行する（ファイル入力→ファイル出力）
// 使い方: node process-one.mjs <job.json> <result.json>
// job.json:
//   { kind: "chat", character: { name, settingsText, relationshipText },
//     history: [{ speakerLabel, text }], targets: [{ text }] }
//   { kind: "group", characters: [{ displayName, settingsText }],
//     history: [{ speakerLabel, text }], targets: [{ text }] }
// result.json:
//   chat : { ok: true, replies: [{ kind: "character", displayName, text }] }
//   group: { ok: true, replies: [...分割結果], abnormal: bool }
//   失敗: { ok: false, errorKind: "timeout"|"generation_error"|"rate_limited", detail }
import { readFileSync, writeFileSync } from "node:fs";
import { buildChatSystem, buildChatUser, buildGroupSystem, buildGroupUser } from "./prompts.mjs";
import { splitGroupOutput } from "./split.mjs";
import { generateWithClaude } from "./generate.mjs";

const [jobPath, resultPath] = process.argv.slice(2);
if (!jobPath || !resultPath) {
  console.error("usage: node process-one.mjs <job.json> <result.json>");
  process.exit(2);
}
const job = JSON.parse(readFileSync(jobPath, "utf8"));

let systemPrompt;
let userPrompt;
if (job.kind === "chat") {
  systemPrompt = buildChatSystem(job.character);
  userPrompt = buildChatUser({
    characterName: job.character.name,
    history: job.history || [],
    targets: job.targets || [],
  });
} else if (job.kind === "group") {
  systemPrompt = buildGroupSystem(job.characters);
  userPrompt = buildGroupUser({ history: job.history || [], targets: job.targets || [] });
} else {
  writeFileSync(resultPath, JSON.stringify({ ok: false, errorKind: "generation_error", detail: `unknown kind: ${job.kind}` }));
  process.exit(0);
}

const generated = await generateWithClaude({ systemPrompt, userPrompt });
if (!generated.ok) {
  writeFileSync(resultPath, JSON.stringify(generated));
  process.exit(0);
}

if (job.kind === "chat") {
  writeFileSync(resultPath, JSON.stringify({
    ok: true,
    replies: [{ kind: "character", displayName: job.character.name, text: generated.text }],
  }));
} else {
  const { items, abnormal } = splitGroupOutput(
    generated.text,
    job.characters.map((c) => c.displayName)
  );
  writeFileSync(resultPath, JSON.stringify({ ok: true, replies: items, abnormal }));
}
