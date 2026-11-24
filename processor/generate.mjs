// キャラチャット: Claude Code 独立プロセスでの生成
// - 分離条件: 空の作業フォルダ、--system-prompt-file で置き換え、--tools "" でツール無効、
//   --no-session-persistence でセッションを残さない。材料は標準入力で渡す。
// - 認証は連携済み Claude Code の通常ログインを使う（設定・メモリ・フックは存在しないことを確認済み。
//   プロジェクト単位の文脈は空の作業フォルダで避ける）。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE_BIN = process.env.CHARA_CLAUDE_BIN || join(process.env.HOME, ".local/bin/claude");
const TIMEOUT_MS = Number(process.env.CHARA_GEN_TIMEOUT_MS || 5 * 60 * 1000);

function classifyError(output) {
  const s = String(output || "").toLowerCase();
  if (s.includes("rate limit") || s.includes("usage limit") || s.includes("limit reached") || s.includes("quota")) {
    return "rate_limited";
  }
  if (s.includes("not logged in") || s.includes("unauthorized") || s.includes("authentication") || s.includes("oauth")) {
    return "generation_error";
  }
  return "generation_error";
}

export function generateWithClaude({ systemPrompt, userPrompt }) {
  return new Promise((resolve) => {
    const workDir = mkdtempSync(join(tmpdir(), "chara-gen-"));
    const promptFile = join(workDir, "system-prompt.txt");
    writeFileSync(promptFile, systemPrompt, "utf8");
    const child = spawn(
      CLAUDE_BIN,
      ["-p", "--system-prompt-file", promptFile, "--tools", "", "--no-session-persistence"],
      { cwd: workDir, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      rmSync(workDir, { recursive: true, force: true });
      resolve({ ok: false, errorKind: "generation_error", detail: String(err?.message || err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(workDir, { recursive: true, force: true });
      if (timedOut) {
        resolve({ ok: false, errorKind: "timeout", detail: `制限時間 ${TIMEOUT_MS}ms を超過` });
        return;
      }
      const text = stdout.trim();
      if (code !== 0) {
        resolve({ ok: false, errorKind: classifyError(stderr || stdout), detail: (stderr || stdout).slice(0, 500) });
        return;
      }
      if (!text) {
        resolve({ ok: false, errorKind: "generation_error", detail: "空の出力" });
        return;
      }
      resolve({ ok: true, text });
    });
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}
