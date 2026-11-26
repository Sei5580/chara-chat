// カテゴリ木ロジックの正（クライアント／サーバ共用・純粋関数）。
//
// 子孫展開・祖先集合・祖先除外（子優先）のアルゴリズムは、以前は
// client/src/App.tsx と server/src/actions.ts の両側にほぼ逐語で
// 二重実装されていた（冗長性レビュー B-6）。規則変更時に片側だけ直すと
// 「画面表示と保存結果が食い違う」形で静かに乖離するため、ここへ一本化し、
// 両側はこのモジュールだけを import する。
//
// 入力はカテゴリの最小形 { id, parentId } の一覧。サーバ側は DB 行
// （categories の行）がそのまま渡せ、クライアント側は応答の
// { id, parent_id } をこの形へ写してから渡す。DB・画面状態には触れない。

export type CategoryTreeNode = { id: number; parentId: number | null };

/**
 * カテゴリ id の子孫ID集合（自分自身を含む）を返す（v1.26・階層化）。
 * 親子関係が壊れて循環していても無限ループしないよう訪問済みで打ち切る。
 */
export function categoryDescendantIds(nodes: readonly CategoryTreeNode[], id: number): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parentId != null) {
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenByParent.set(n.parentId, arr);
    }
  }
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/**
 * カテゴリ id の祖先ID集合（親・祖父…。自分自身は含まない）を返す
 * （v1.27・設計書 v1.7.1）。親子関係が壊れて循環していても訪問済みで打ち切る。
 */
export function categoryAncestorIds(nodes: readonly CategoryTreeNode[], id: number): Set<number> {
  const parentById = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
  const out = new Set<number>();
  let cur = parentById.get(id) ?? null;
  while (cur != null && !out.has(cur)) {
    out.add(cur);
    cur = parentById.get(cur) ?? null;
  }
  out.delete(id);
  return out;
}

/**
 * 割り当て集合の祖先除外（v1.27・設計書 v1.7.1）: 集合内に自分の子孫が存在する
 * カテゴリ（祖先側）を落とし、より深い側（子）だけを残す。子カテゴリとその
 * 祖先カテゴリは同時に付けられない、という規則の実体。
 */
export function pruneAncestorCategoryIds(nodes: readonly CategoryTreeNode[], ids: readonly number[]): number[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (const other of set) {
      if (other !== id && categoryAncestorIds(nodes, other).has(id)) return false;
    }
    return true;
  });
}
