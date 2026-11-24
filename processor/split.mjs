// キャラチャット: グループ生成結果の分割（設計書8章の規則）
// 判定順: (1) 正規化後にコロン前が表示名と完全一致 → そのキャラの発言
//         (2) 「名前：」形（コロン前が20字以内・空白なし）で名簿外 → raw
//         (3) それ以外 → 直前の発言の続き（直前が raw なら raw に連結、直前が無ければ raw）

function normalize(line) {
  return line.replace(/：/g, ":").replace(/　/g, " ").trim();
}

// 行が「名前:本文」の形かどうかを返す（コロン前の部分）
function namePartOf(line) {
  const n = normalize(line);
  const idx = n.indexOf(":");
  if (idx <= 0) return null;
  return n.slice(0, idx).trim();
}

export function splitGroupOutput(text, displayNames) {
  const roster = new Map(displayNames.map((name) => [normalize(name), name]));
  const out = []; // { kind: 'character'|'raw', displayName?, text, abnormal }
  let abnormal = false;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const namePart = namePartOf(line);
    const normalized = normalize(line);
    if (namePart && roster.has(normalize(namePart))) {
      const displayName = roster.get(normalize(namePart));
      const body = normalized.slice(normalized.indexOf(":") + 1).trim();
      out.push({ kind: "character", displayName, text: body, abnormal: false });
      continue;
    }
    if (namePart && namePart.length <= 20 && !/\s/.test(namePart)) {
      // 名簿外の名前らしい行は、続きにせず raw として原文保存
      abnormal = true;
      out.push({ kind: "raw", text: line, abnormal: true });
      continue;
    }
    const prev = out[out.length - 1];
    if (prev) {
      prev.text += "\n" + line;
    } else {
      abnormal = true;
      out.push({ kind: "raw", text: line, abnormal: true });
    }
  }
  if (out.length > 0 && !out.some((o) => o.kind === "character")) {
    // 有効な行が1つも無い場合は全体を raw 1件にする
    return {
      items: [{ kind: "raw", text: String(text ?? "").trim(), abnormal: true }],
      abnormal: true,
    };
  }
  return { items: out, abnormal };
}
