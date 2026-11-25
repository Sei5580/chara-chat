import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim, setFailureNoticeText } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";

setFailureNoticeText((error) => {
  const e = error as { issues?: unknown; message?: string } | null;
  if (e && Array.isArray(e.issues)) return "入力内容を確認してください。";
  if (e?.message) return e.message;
  return "うまくいきませんでした。もう一度お試しください。";
});

const FIELDS = actionFields<typeof Actions>();

type Home = ApiResponse<typeof api, "listHome">;
type CharacterItem = Home["characters"][number];
type GroupItem = Home["groups"][number];
type ChatState = ApiResponse<typeof api, "getChatState">;
type GroupState = ApiResponse<typeof api, "getGroupState">;
type RequestInfo = ChatState["request"];

type View =
  | { kind: "home" }
  // unreadFromSeq: 開く直時点での未読の先頭キャラ発言の seq（設計書 v1.8 / 4.9章）。
  // 一覧（listHome）が計算した値を遷移時に固定して渡し、開いている間に
  // 到着した返信では区切り位置が動かないようにする。未読が無ければ null。
  | { kind: "chat"; characterId: number; unreadFromSeq: number | null }
  | { kind: "group"; groupId: number; unreadFromSeq: number | null }
  // 全体ログ（履歴ページ、設計書 v2.0 / D）。入口はホーム下部の目立たないリンク。
  | { kind: "logs" };

type SchedulesData = ApiResponse<typeof api, "listSchedules">;
type ScheduleItem = SchedulesData["schedules"][number];
type AppLogsData = ApiResponse<typeof api, "listAppLogs">;
type AppLogItem = AppLogsData["logs"][number];

const FAIL_REASONS: Record<string, string> = {
  timeout: "タイムアウト（10分以内に生成が終わりませんでした）",
  rate_limited: "Claudeの利用上限に達しました。時間をおいて再度お試しください",
  auth_error: "生成に使うClaudeのログインセッションが切れています。再ログインすると直ります",
  generation_error: "生成に失敗しました",
};

function failReasonLabel(reason: string): string {
  return FAIL_REASONS[reason] ?? (reason ? `生成に失敗しました（${reason}）` : "生成に失敗しました");
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// スマホ（タッチ主体の端末）かどうか。PC では Enter で送信するが、スマホでは
// Enter は改行にし、送信は送信ボタンで行う（利用者の要望）。判定は
// pointer: coarse（主ポインタがタッチ）で行い、タッチ対応 PC でもマウス・
// キーボード主体なら Enter 送信のままになる。
function isTouchPrimary(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

// チャット画面のレイアウト固定（v1.16 で整理）: 対策は次の2つだけに絞る。
// (1) チャット画面表示中は body のスクロールを止める（このフック）。
//     あわせて theme.css の overscroll-behavior: none で引っ張り更新を消す。
// (2) 画面の箱は 100dvh の固定配置 flex 列とし、入力欄は最下段に置く。
// キーボード表示時の追従は JS では一切補正せず、index.html の viewport
// メタ（interactive-widget=resizes-content）でブラウザ自身がレイアウト
// ビューポートを縮めるのに任せる。100dvh がそのまま縮むので、入力欄は
// キーボードの真上に来る。
// v1.13〜v1.15 では visualViewport 追従シェル／計算式インセット／実測
// フィードバック補正を重ねたが、ブラウザ側の縮小と二重に効いて入力欄の
// 下に空白が残り続けたため、補正系は全て撤去し仕組みをこの1本に統一した。
function useLockBodyScroll() {
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);
}

function Avatar({
  imageUrl,
  name,
  themeColor,
  size,
}: {
  imageUrl: string | null;
  name: string;
  themeColor: string;
  size: number;
}) {
  const ring = themeColor || "var(--accent)";
  const [imgError, setImgError] = useState(false);
  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setImgError(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${ring}` }}
      />
    );
  }
  return (
    <div
      aria-label={name}
      className="font-display flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color: "var(--surface)",
        background: ring,
        boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${ring}`,
      }}
    >
      {name.slice(0, 1)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending")
    return <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--gold)" }}>返信待ち</span>;
  if (status === "processing")
    return <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>生成中</span>;
  if (status === "failed")
    return <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--danger)" }}>失敗</span>;
  return null;
}

function RequestBanner({ request, isGroup }: { request: RequestInfo; isGroup?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (request.status !== "pending" && request.status !== "processing") return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [request.status]);
  if (request.status === "none") return null;
  if (request.status === "failed") {
    return (
      <div className="mx-3 mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--danger)" }} role="status">
        {failReasonLabel(request.fail_reason)}。送った文章は入力欄に戻してあります。
      </div>
    );
  }
  const elapsed = request.requested_at
    ? Math.max(0, Math.floor((now - new Date(request.requested_at).getTime()) / 1000))
    : request.elapsed_seconds;
  return (
    <div className="mx-3 mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--text)" }} role="status">
      {request.status === "processing"
        ? `${isGroup ? "掛け合い" : "返信"}を生成中です…（${formatElapsed(elapsed)}経過）`
        : `${isGroup ? "掛け合い" : "返信"}待ちです（発言から${formatElapsed(elapsed)}）。生成には数分かかることがあります。`}
    </div>
  );
}

/** チャット画面内の「新着」区切り（LINE風、設計書 v1.8 / 4.9章）。未読の先頭発言の直前に置く。 */
function NewMessageDivider() {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label="ここから新着の返信です">
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full" style={{ background: "var(--danger)" }} />
      <span className="text-xs font-black tracking-widest" style={{ color: "var(--danger)" }}>新着</span>
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full" style={{ background: "var(--danger)" }} />
    </div>
  );
}

/** チャット全文出力シート（設計書 v1.8 / 4.12章）。全履歴をプレーンテキストで表示し、全文コピーできる。 */
function ExportSheet({
  title,
  queryKey,
  fetchText,
  onClose,
}: {
  title: string;
  queryKey: string[];
  fetchText: () => Promise<{ text: string }>;
  onClose: () => void;
}) {
  const q = useQuery({ queryKey, queryFn: fetchText });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyAll = async () => {
    if (!q.data) return;
    try {
      await navigator.clipboard.writeText(q.data.text);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="全文出力を閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
          このチャットの全履歴を「発言者名:内容」の形で時系列順に並べたプレーンテキストです。
        </p>
        {q.isPending && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {q.error && (
          <div className="mt-3">
            <p className="text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>
            <button type="button" onClick={() => q.refetch()} className="mt-2 rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
              再読み込み
            </button>
          </div>
        )}
        {q.data && (
          <>
            <label className="sr-only" htmlFor="export-text">チャット全文</label>
            <textarea
              id="export-text"
              readOnly
              value={q.data.text}
              rows={14}
              className="mt-3 min-h-0 w-full flex-1 rounded-2xl p-3 text-sm"
              style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            {copyFailed && (
              <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>コピーできませんでした。上のテキストを長押し（または全選択）してコピーしてください。</p>
            )}
            <button
              type="button"
              onClick={copyAll}
              className="mt-3 w-full rounded-full px-4 py-2.5 font-bold text-white"
              style={{ background: "var(--accent)" }}
            >
              {copied ? "コピーしました" : "全文をコピー"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>{title}</h2>
        <p className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--dim)" }}>{body}</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full px-4 py-2.5 font-bold"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--danger)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ image edit

const CROP_VIEW = 280;
const CROP_OUT = 512;

/**
 * 戻し下書きを入力欄へ復元する。本文が変わった時だけ復元し、失敗の通知は
 * 失敗理由が付いている時（＝まだ表示済みになっていない失敗の初回表示）だけ出す。
 * サーバ側は会話を一度開くと失敗を表示済みにし、次回からは fail_reason を
 * 空で返すため、通知は次に開いた時から出なくなる（本文の復元だけが残る）。
 */
function useDraftRestore(
  draft: { body: string; fail_reason: string } | null | undefined,
  setDraftText: (v: string) => void,
  setNotice: (v: string) => void,
) {
  const restoredRef = useRef<string | null>(null);
  const noticedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft) {
      restoredRef.current = null;
      noticedRef.current = null;
      return;
    }
    if (draft.body && restoredRef.current !== draft.body) {
      restoredRef.current = draft.body;
      setDraftText(draft.body);
    }
    if (draft.fail_reason) {
      const key = `${draft.body}\n${draft.fail_reason}`;
      if (noticedRef.current !== key) {
        noticedRef.current = key;
        setNotice(`返信に失敗しました（${failReasonLabel(draft.fail_reason)}）。文章を入力欄に戻しました。そのまま、または直して再送信できます。`);
      }
    }
  }, [draft, setDraftText, setNotice]);
}

function ImageEditSheet({
  characterId,
  characterName,
  currentImageUrl,
  onClose,
}: {
  characterId: number;
  characterName: string;
  currentImageUrl: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgName, setImgName] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const save = useMutation({
    mutationFn: async (payload: { image_base64: string; image_mime: string }) =>
      await api.updateCharacterImage({ character_id: characterId, image_base64: payload.image_base64, image_mime: payload.image_mime }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["chat", characterId] });
      queryClient.invalidateQueries({ queryKey: ["group"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });

  const baseScale = img ? Math.max(CROP_VIEW / img.naturalWidth, CROP_VIEW / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  // プレビューに実際に描く画像の表示サイズ（px）。枠より大きい実寸で描くことで、
  // ドラッグで枠外へ動かしても、元々はみ出していた部分がそのまま現れる。
  const dispW = img ? img.naturalWidth * scale : 0;
  const dispH = img ? img.naturalHeight * scale : 0;

  const clampOffset = (x: number, y: number, z: number, image: HTMLImageElement) => {
    const s = Math.max(CROP_VIEW / image.naturalWidth, CROP_VIEW / image.naturalHeight) * z;
    const maxX = Math.max(0, (image.naturalWidth * s - CROP_VIEW) / 2);
    const maxY = Math.max(0, (image.naturalHeight * s - CROP_VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選んでください。");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setImgName(file.name);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError("");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("画像を読み込めませんでした。別のファイルをお試しください。");
    };
    image.src = url;
  };

  const doSave = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = CROP_OUT;
    canvas.height = CROP_OUT;
    const cx = canvas.getContext("2d");
    if (!cx) {
      setError("画像の処理に失敗しました。");
      return;
    }
    // プレビューで見えている範囲（元画像上の正方形の矩形）をそのまま切り取って
    // 512×512 へ描く。矩形は1辺 vis の正方形なので、縦横の倍率は必ず均等になる。
    const vis = CROP_VIEW / scale;
    const sx = img.naturalWidth / 2 - offset.x / scale - vis / 2;
    const sy = img.naturalHeight / 2 - offset.y / scale - vis / 2;
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, CROP_OUT, CROP_OUT);
    cx.drawImage(img, sx, sy, vis, vis, 0, 0, CROP_OUT, CROP_OUT);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) {
      setError("画像の処理に失敗しました。");
      return;
    }
    save.mutate({ image_base64: base64, image_mime: "image/jpeg" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={`${characterName}の画像を変更`}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>{characterName}の画像を変更</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          画像ファイルを選んで正方形にトリミングして保存すると、一覧・チャット・グループの表示にすぐ反映されます。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="画像ファイルを選ぶ"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-4 w-full rounded-full px-4 py-2.5 font-bold"
          style={{ background: "var(--surface-alt)", color: "var(--text)" }}
        >
          {img ? "別の画像を選ぶ" : "画像ファイルを選ぶ"}
        </button>
        {imgName && <p className="mt-1 truncate text-xs" style={{ color: "var(--dim)" }}>{imgName}</p>}

        {img ? (
          <>
            <div
              className="relative mx-auto mt-4 overflow-hidden rounded-2xl"
              style={{ width: CROP_VIEW, height: CROP_VIEW, background: "var(--surface-alt)", touchAction: "none", cursor: "grab" }}
              role="application"
              aria-label="トリミング範囲。ドラッグで位置を調整できます"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                setOffset(clampOffset(d.baseX + (e.clientX - d.startX), d.baseY + (e.clientY - d.startY), zoom, img));
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <img
                src={img.src}
                alt="トリミング中の画像"
                draggable={false}
                className="absolute select-none"
                style={{
                  // 画像を「表示倍率での実寸」で描き、枠の中心＋ドラッグ量の位置に置く。
                  // object-fit: cover で要素いっぱいに描く方式だと、要素の箱の外側は
                  // 描画されず、ドラッグで最初に表示されていた領域の外が空白になる。
                  // 実寸描画なら枠外にはみ出した部分も描画済みで、ドラッグで現れる。
                  // maxWidth/maxHeight: none は Tailwind プリフライトの
                  // img { max-width: 100% } に幅だけ潰される事故（v1.6.1）の再発防止。
                  width: dispW,
                  height: dispH,
                  maxWidth: "none",
                  maxHeight: "none",
                  left: (CROP_VIEW - dispW) / 2 + offset.x,
                  top: (CROP_VIEW - dispH) / 2 + offset.y,
                }}
              />
            </div>
            <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="crop-zoom">
              拡大・縮小
            </label>
            <input
              id="crop-zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoom(z);
                setOffset((o) => clampOffset(o.x, o.y, z, img));
              }}
              className="mt-1 w-full"
              aria-label="拡大・縮小"
            />
            <p className="text-xs" style={{ color: "var(--dim)" }}>プレビューは上の枠の通りです。ドラッグで位置を調整できます。</p>
          </>
        ) : (
          currentImageUrl && (
            <div className="mt-4 flex items-center gap-3">
              <img src={currentImageUrl} alt={`${characterName}の現在の画像`} width={64} height={64} className="rounded-full object-cover" style={{ width: 64, height: 64 }} />
              <p className="text-sm" style={{ color: "var(--dim)" }}>現在の画像です。新しい画像を選ぶと差し替わります。</p>
            </div>
          )
        )}

        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={!img || save.isPending}
            onClick={doSave}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : "トリミングして保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ character settings menu (v1.8)

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </svg>
  );
}

/** キャラ一覧の設定ボタンから開くメニュー。項目は今後ここへ追加していく。 */
function CharacterMenuSheet({
  character,
  onClose,
  onViewSettings,
  onEditSettings,
  onEditImage,
  onRename,
  onSetCategory,
}: {
  character: CharacterItem;
  onClose: () => void;
  onViewSettings: () => void;
  onEditSettings: () => void;
  onEditImage: () => void;
  onRename: () => void;
  onSetCategory: () => void;
}) {
  const items: { label: string; description: string; onSelect: () => void }[] = [
    { label: "概要を確認する", description: "設定本文と関係・呼び方を確認します", onSelect: onViewSettings },
    { label: "設定を編集する", description: "項目ごとの入力欄で設定を書き換えます", onSelect: onEditSettings },
    { label: "画像を変更", description: "画像を選んでトリミングして差し替えます", onSelect: onEditImage },
    { label: "表示名を変更", description: "表示される名前だけを変えます", onSelect: onRename },
    { label: "カテゴリを設定", description: "カテゴリを選んで分類します（複数選択可）", onSelect: onSetCategory },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={`${character.display_name}の設定メニュー`}>
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-center gap-3">
          <Avatar imageUrl={character.image_url} name={character.display_name} themeColor={character.theme_color} size={40} />
          <h2 className="font-display min-w-0 flex-1 truncate text-lg font-bold" style={{ color: "var(--text)" }}>{character.display_name}の設定</h2>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onSelect}
              className="w-full rounded-2xl px-4 py-3 text-left"
              style={{ background: "var(--surface-alt)", color: "var(--text)" }}
            >
              <span className="block font-bold">{item.label}</span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--dim)" }}>{item.description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full px-4 py-2.5 font-bold"
          style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

/** キャラ設定の閲覧シート（読み取り専用）。 */
function CharacterSettingsSheet({ characterId, onClose }: { characterId: number; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["character-settings", characterId],
    queryFn: () => api.getCharacterSettings({ character_id: characterId }),
  });
  const d = q.data;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="キャラ設定">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>キャラ設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>
        {q.isPending && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {q.error && (
          <div className="mt-3">
            <p className="text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>
            <button type="button" onClick={() => q.refetch()} className="mt-2 rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
              再読み込み
            </button>
          </div>
        )}
        {d && (
          <div className="mt-3 flex flex-col gap-4">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-bold" style={{ color: "var(--dim)" }}>表示名</dt>
                <dd style={{ color: "var(--text)" }}>{d.display_name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-bold" style={{ color: "var(--dim)" }}>元の名前</dt>
                <dd style={{ color: "var(--text)" }}>{d.name}</dd>
              </div>
              {d.source_profile_id && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-bold" style={{ color: "var(--dim)" }}>取り込み元ID</dt>
                  <dd className="break-all" style={{ color: "var(--text)" }}>{d.source_profile_id}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-bold" style={{ color: "var(--dim)" }}>登録日時</dt>
                <dd style={{ color: "var(--text)" }}>{new Date(d.created_at).toLocaleString("ja-JP")}</dd>
              </div>
            </dl>
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>設定本文（生成に使われる内容）</h3>
              <p className="mt-1.5 rounded-2xl p-3 text-sm leading-relaxed whitespace-pre-wrap" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
                {d.settings_text}
              </p>
            </div>
            {d.relation_text && (
              <div>
                <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>関係・呼び方</h3>
                <p className="mt-1.5 rounded-2xl p-3 text-sm leading-relaxed whitespace-pre-wrap" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
                  {d.relation_text}
                </p>
              </div>
            )}
            <p className="text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              設定の書き換えは設定メニューの「設定を編集する」から、発言への指摘はチャット画面のレビューモードから行えます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

type SettingsFormData = ApiResponse<typeof api, "getCharacterSettingsForm">;

const editInputStyle = {
  background: "var(--surface-alt)",
  color: "var(--text)",
  border: "1px solid var(--border)",
} as const;

function EditTextField({
  label,
  fieldProps,
  value,
  onChange,
}: {
  label: string;
  fieldProps?: Record<string, unknown>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-bold" style={{ color: "var(--text)" }}>
        {label}
        <input
          {...fieldProps}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-2xl px-3 py-2.5 font-normal"
          style={editInputStyle}
        />
      </label>
    </div>
  );
}

function EditAreaField({
  label,
  fieldProps,
  value,
  onChange,
  rows = 4,
  hint,
}: {
  label: string;
  fieldProps?: Record<string, unknown>;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-bold" style={{ color: "var(--text)" }}>
        {label}
        <textarea
          {...fieldProps}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="mt-1 w-full rounded-2xl px-3 py-2.5 font-normal"
          style={editInputStyle}
        />
      </label>
      {hint && (
        <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{hint}</p>
      )}
    </div>
  );
}

function EditSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base font-bold" style={{ color: "var(--text)" }}>{title}</h3>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </section>
  );
}

type TraitDraft = { id: string; label: string; examplesText: string; enabled: boolean };
type ElementDraft = { key: string; value: string };

/** 設定の編集フォーム本体。初期値は取得済みのフォームデータから作る。 */
function CharacterSettingsEditForm({
  character,
  initial,
  onClose,
}: {
  character: CharacterItem;
  initial: SettingsFormData;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const F = FIELDS.updateCharacterSettings;
  const [name, setName] = useState(initial.name);
  const [summary, setSummary] = useState(initial.summary);
  const [greeting, setGreeting] = useState(initial.greeting);
  const [backgroundText, setBackgroundText] = useState(initial.background_text);
  const [linksText, setLinksText] = useState(initial.background_links.join("\n"));
  const [linkSummary, setLinkSummary] = useState(initial.link_summary);
  const [portrayalFocus, setPortrayalFocus] = useState(initial.portrayal_focus);
  const [videoUrlsText, setVideoUrlsText] = useState(initial.video_urls.join("\n"));
  const [videoNotes, setVideoNotes] = useState(initial.video_notes);
  const [userRelationship, setUserRelationship] = useState(initial.user_relationship);
  const [callUserAs, setCallUserAs] = useState(initial.call_user_as);
  const [speechStyle, setSpeechStyle] = useState(initial.speech_style);
  const [firstPerson, setFirstPerson] = useState(initial.speech_first_person);
  const [secondPerson, setSecondPerson] = useState(initial.speech_second_person);
  const [catchphrase, setCatchphrase] = useState(initial.speech_catchphrase);
  const [speechMemo, setSpeechMemo] = useState(initial.speech_memo);
  const [avatarMemory, setAvatarMemory] = useState(initial.avatar_memory);
  const [elements, setElements] = useState<ElementDraft[]>(initial.elements);
  const [traits, setTraits] = useState<TraitDraft[]>(
    initial.traits.map((t) => ({ id: t.id, label: t.label, examplesText: t.examples.join("\n"), enabled: t.enabled })),
  );
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () =>
      await api.updateCharacterSettings({
        character_id: character.id,
        name: name.trim(),
        summary,
        greeting,
        background_text: backgroundText,
        background_links: linksText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        link_summary: linkSummary,
        portrayal_focus: portrayalFocus,
        video_urls: videoUrlsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        video_notes: videoNotes,
        user_relationship: userRelationship,
        call_user_as: callUserAs,
        speech_style: speechStyle,
        speech_first_person: firstPerson,
        speech_second_person: secondPerson,
        speech_catchphrase: catchphrase,
        speech_memo: speechMemo,
        avatar_memory: avatarMemory,
        elements,
        traits: traits.map((t) => ({
          id: t.id,
          label: t.label,
          examples: t.examplesText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
          enabled: t.enabled,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["chat", character.id] });
      queryClient.invalidateQueries({ queryKey: ["group"] });
      queryClient.invalidateQueries({ queryKey: ["character-settings", character.id] });
      queryClient.invalidateQueries({ queryKey: ["character-settings-form", character.id] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });

  const submit = () => {
    if (!name.trim()) {
      setError("名前を入力してください。");
      return;
    }
    setError("");
    save.mutate();
  };

  const updateTrait = (idx: number, patch: Partial<TraitDraft>) =>
    setTraits((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const updateElement = (idx: number, patch: Partial<ElementDraft>) =>
    setElements((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
        保存すると、このアプリ内の設定が書き換わり、次の返信から反映されます（アバター管理ツール側の設定と表示名は変わりません）。
      </p>

      <EditSection title="基本">
        <EditTextField label="名前" fieldProps={F.name} value={name} onChange={setName} />
        <EditAreaField label="概要" fieldProps={F.summary} value={summary} onChange={setSummary} rows={3} />
        <EditAreaField label="挨拶の例" fieldProps={F.greeting} value={greeting} onChange={setGreeting} rows={3} />
        <EditAreaField label="固有の記憶" fieldProps={F.avatar_memory} value={avatarMemory} onChange={setAvatarMemory} rows={3} />
      </EditSection>

      <EditSection title="背景">
        <EditAreaField label="背景（本文）" fieldProps={F.background_text} value={backgroundText} onChange={setBackgroundText} rows={8} />
        <EditAreaField label="関連リンク" value={linksText} onChange={setLinksText} rows={3} hint="1行に1件ずつ入力してください。" />
        <EditAreaField label="つながりの要約" fieldProps={F.link_summary} value={linkSummary} onChange={setLinkSummary} rows={4} />
        <EditAreaField label="演じる姿・状況" fieldProps={F.portrayal_focus} value={portrayalFocus} onChange={setPortrayalFocus} rows={3} hint="このキャラクターを演じる前提の姿・状況です。空欄なら指定なしです。" />
        <EditAreaField label="参考動画URL" value={videoUrlsText} onChange={setVideoUrlsText} rows={3} hint="1行に1件ずつ入力してください。" />
      </EditSection>

      <EditSection title="話し方">
        <EditAreaField label="話し方の説明" fieldProps={F.speech_style} value={speechStyle} onChange={setSpeechStyle} rows={4} />
        <EditTextField label="一人称" fieldProps={F.speech_first_person} value={firstPerson} onChange={setFirstPerson} />
        <EditTextField label="二人称" fieldProps={F.speech_second_person} value={secondPerson} onChange={setSecondPerson} />
        <EditAreaField label="口癖" fieldProps={F.speech_catchphrase} value={catchphrase} onChange={setCatchphrase} rows={2} />
        <EditAreaField label="話し方のメモ" fieldProps={F.speech_memo} value={speechMemo} onChange={setSpeechMemo} rows={3} />
        <EditAreaField label="口調の参考資料（参考動画の所見）" fieldProps={F.video_notes} value={videoNotes} onChange={setVideoNotes} rows={4} hint="参考動画の台詞から得た口調の所見です。参考資料であり、台詞や言い回しの正本ではありません。" />
      </EditSection>

      <EditSection title="相手との関係">
        <EditAreaField label="相手との関係" fieldProps={F.user_relationship} value={userRelationship} onChange={setUserRelationship} rows={3} />
        <EditTextField label="相手の呼び方" fieldProps={F.call_user_as} value={callUserAs} onChange={setCallUserAs} />
      </EditSection>

      <EditSection title="見た目の要素">
        <div className="flex flex-col gap-2">
          {elements.map((el, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                aria-label={`見た目の要素${i + 1}の項目名`}
                value={el.key}
                onChange={(e) => updateElement(i, { key: e.target.value })}
                placeholder="項目名（例: 髪）"
                className="w-28 shrink-0 rounded-2xl px-3 py-2.5 text-sm"
                style={editInputStyle}
              />
              <input
                aria-label={`見た目の要素${i + 1}の内容`}
                value={el.value}
                onChange={(e) => updateElement(i, { value: e.target.value })}
                placeholder="内容"
                className="min-w-0 flex-1 rounded-2xl px-3 py-2.5 text-sm"
                style={editInputStyle}
              />
              <button
                type="button"
                aria-label={`見た目の要素${i + 1}を削除`}
                onClick={() => setElements((prev) => prev.filter((_, j) => j !== i))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base"
                style={{ background: "var(--surface-alt)", color: "var(--danger)" }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setElements((prev) => [...prev, { key: "", value: "" }])}
            className="self-start rounded-full px-4 py-2 text-sm font-bold"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            ＋ 要素を追加
          </button>
        </div>
      </EditSection>

      <EditSection title="フレーバー特性">
        <div className="flex flex-col gap-3">
          {traits.map((t, i) => (
            <div key={i} className="rounded-2xl p-3" style={{ background: "var(--surface-alt)" }}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`フレーバー特性${i + 1}の名前`}
                  value={t.label}
                  onChange={(e) => updateTrait(i, { label: e.target.value })}
                  placeholder="特性の名前"
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-bold"
                  style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
                />
                <button
                  type="button"
                  aria-label={`フレーバー特性${i + 1}を削除`}
                  onClick={() => setTraits((prev) => prev.filter((_, j) => j !== i))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
                  style={{ background: "var(--surface)", color: "var(--danger)" }}
                >
                  ×
                </button>
              </div>
              <label className="mt-2 block text-xs font-bold" style={{ color: "var(--dim)" }}>
                例（1行に1件）
                <textarea
                  value={t.examplesText}
                  onChange={(e) => updateTrait(i, { examplesText: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal"
                  style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => updateTrait(i, { enabled: e.target.checked })}
                  className="h-5 w-5"
                />
                この特性を有効にする
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTraits((prev) => [...prev, { id: "", label: "", examplesText: "", enabled: true }])}
            className="self-start rounded-full px-4 py-2 text-sm font-bold"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            ＋ 特性を追加
          </button>
        </div>
      </EditSection>

      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
          キャンセル
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {save.isPending ? "保存中…" : "保存する"}
        </button>
      </div>
    </div>
  );
}

/** 設定を編集するシート（設定メニューから開く）。フォームデータを取得してから編集フォームを表示する。 */
function CharacterSettingsEditSheet({ character, onClose }: { character: CharacterItem; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["character-settings-form", character.id],
    queryFn: () => api.getCharacterSettingsForm({ character_id: character.id }),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={`${character.display_name}の設定を編集する`}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>設定を編集する</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>
        {q.isPending && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {q.error && (
          <div className="mt-3">
            <p className="text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>
            <button type="button" onClick={() => q.refetch()} className="mt-2 rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
              再読み込み
            </button>
          </div>
        )}
        {q.data && !q.data.editable && (
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
            このキャラクターは設定データ（avatar-profile形式）を保持していないため、ここからは編集できません。
          </p>
        )}
        {q.data && q.data.editable && (
          <div className="mt-3">
            <CharacterSettingsEditForm character={character} initial={q.data} onClose={onClose} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 表示名の変更シート。設定本文・会話履歴には影響しない。 */
function RenameCharacterSheet({ character, onClose }: { character: CharacterItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(character.display_name);
  const [error, setError] = useState("");
  const rename = useMutation({
    mutationFn: async (displayName: string) => await api.renameCharacter({ character_id: character.id, display_name: displayName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["chat", character.id] });
      queryClient.invalidateQueries({ queryKey: ["group"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "変更に失敗しました"),
  });
  const submit = () => {
    const v = name.trim();
    if (!v) {
      setError("表示名を入力してください。");
      return;
    }
    if (v === character.display_name) {
      onClose();
      return;
    }
    setError("");
    rename.mutate(v);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="表示名を変更">
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>表示名を変更</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          一覧やチャットで表示される名前だけを変えます（設定や会話履歴には影響しません）。
        </p>
        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="rename-display-name">
          表示名
        </label>
        <input
          id="rename-display-name"
          {...FIELDS.renameCharacter.display_name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl px-3 py-2.5"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={rename.isPending}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {rename.isPending ? "保存中…" : "変更する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ categories (v1.10 / 設計書 4.11)

type CategoryItem = Home["categories"][number];

type CategoryTreeEntry = { cat: CategoryItem; depth: number };

/**
 * カテゴリを階層（ツリー）順に並べた一覧を返す（v1.26・階層化）。
 * 親→子の順に辿り、各項目に深さ（最上位=0）を持たせる。兄弟の並びは登録順。
 * 親が存在しないカテゴリは最上位として扱い、循環などで辿れなかったものも
 * 表示から消えないよう最上位として末尾に置く。
 */
function categoryTreeEntries(categories: CategoryItem[]): CategoryTreeEntry[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenByParent = new Map<number | null, CategoryItem[]>();
  for (const c of categories) {
    const key = c.parent_id != null && byId.has(c.parent_id) ? c.parent_id : null;
    const arr = childrenByParent.get(key) ?? [];
    arr.push(c);
    childrenByParent.set(key, arr);
  }
  const out: CategoryTreeEntry[] = [];
  const visited = new Set<number>();
  const walk = (parentKey: number | null, depth: number) => {
    for (const c of childrenByParent.get(parentKey) ?? []) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const c of categories) {
    if (!visited.has(c.id)) out.push({ cat: c, depth: 0 });
  }
  return out;
}

/** カテゴリ id の子孫ID集合（自分自身を含む）。絞り込みの共通判定に使う（v1.26）。 */
function categoryDescendantIdSet(categories: CategoryItem[], id: number): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const c of categories) {
    if (c.parent_id != null) {
      const arr = childrenByParent.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenByParent.set(c.parent_id, arr);
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

/** カテゴリ id の祖先ID集合（親・祖父…。自分自身は含まない）（v1.27・設計書 v1.7.1）。 */
function categoryAncestorIdSet(categories: CategoryItem[], id: number): Set<number> {
  const parentById = new Map(categories.map((c) => [c.id, c.parent_id ?? null]));
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
 * 割り当て集合から祖先側を落として子だけを残す（v1.27・設計書 v1.7.1）。
 * サーバ側の強制と同じ規則を、割り当てシートの初期表示・操作にも適用する。
 */
function pruneAncestorCategoryIds(categories: CategoryItem[], ids: number[]): number[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (const other of set) {
      if (other !== id && categoryAncestorIdSet(categories, other).has(id)) return false;
    }
    return true;
  });
}

/** キャラがカテゴリ filterId（その子孫カテゴリを含む）に属するか（v1.26）。 */
function charMatchesCategory(c: CharacterItem, categories: CategoryItem[], filterId: number): boolean {
  const set = categoryDescendantIdSet(categories, filterId);
  return charCategoryIds(c).some((cid) => set.has(cid));
}

/** セレクトの選択肢表示用の階段式ラベル（深さぶん全角スペースで字下げする）。 */
function categoryOptionLabel(cat: CategoryItem, depth: number): string {
  return depth > 0 ? `${"　".repeat(depth)}└ ${cat.name}` : cat.name;
}

/** カテゴリの管理シート（一覧側の全体メニューから開く）。追加・編集（名前と親カテゴリ）・削除を行う。 */
function CategoryManageSheet({ categories, onClose }: { categories: CategoryItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<CategoryItem | null>(null);
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<number | null>(null);
  const tree = categoryTreeEntries(categories);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const create = useMutation({
    mutationFn: async (v: { name: string; parent_id: number | null }) => await api.createCategory({ name: v.name, parent_id: v.parent_id }),
    onSuccess: () => {
      setName("");
      setParentId(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "追加に失敗しました"),
  });
  const update = useMutation({
    mutationFn: async (v: { category_id: number; name: string; parent_id: number | null }) =>
      await api.updateCategory({ category_id: v.category_id, name: v.name, parent_id: v.parent_id }),
    onSuccess: () => {
      setEditing(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  const del = useMutation({
    mutationFn: async (id: number) => await api.deleteCategory({ category_id: id }),
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "削除に失敗しました"),
  });
  const submit = () => {
    const v = name.trim();
    if (!v) { setError("カテゴリ名を入力してください。"); return; }
    setError("");
    create.mutate({ name: v, parent_id: parentId });
  };
  const startEdit = (cat: CategoryItem) => {
    setEditing(cat);
    setEditName(cat.name);
    setEditParentId(cat.parent_id ?? null);
    setConfirmDelete(null);
    setError("");
  };
  const submitEdit = () => {
    if (!editing) return;
    const v = editName.trim();
    if (!v) { setError("カテゴリ名を入力してください。"); return; }
    setError("");
    update.mutate({ category_id: editing.id, name: v, parent_id: editParentId });
  };
  // 編集中カテゴリの親の選択肢: 自分自身と自分の子孫は選べない（循環防止）。
  const editBlockedIds = editing ? categoryDescendantIdSet(categories, editing.id) : new Set<number>();
  const childCountOf = (id: number) => categories.filter((c) => c.parent_id === id).length;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="カテゴリ管理">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>カテゴリ管理</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="カテゴリ管理を閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
          カテゴリはキャラ一覧の絞り込みに使います。カテゴリには親カテゴリを設定でき、子カテゴリ（サブカテゴリ）を作れます。親カテゴリで絞り込むと、その子・孫カテゴリのキャラもまとめて表示されます。1キャラに複数のカテゴリを設定でき、複数に登録したキャラはどのカテゴリで絞り込んでも表示されます。各キャラへの割り当ては、キャラの設定メニュー「カテゴリを設定」から行います。子カテゴリとその親カテゴリは同時には付けられず、両方が付いた状態になると子カテゴリだけが残ります（親子関係を後から変えた時も、既存の割り当ては自動で子だけに整理されます）。カテゴリを削除すると、その子カテゴリは削除したカテゴリの親の下へ移動し、各キャラからはそのカテゴリだけが外れます（他のカテゴリは残ります）。
        </p>

        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="category-name">
          新しいカテゴリ名
        </label>
        <input
          id="category-name"
          {...FIELDS.createCategory.name}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          placeholder="例: ゲーム"
          className="mt-1 w-full rounded-2xl px-3 py-2.5"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        <label className="mt-3 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="category-parent">
          親カテゴリ
        </label>
        <select
          id="category-parent"
          value={parentId === null ? "" : String(parentId)}
          onChange={(e) => setParentId(e.target.value === "" ? null : Number(e.target.value))}
          className="mt-1 w-full rounded-2xl px-3 py-2.5"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          <option value="">最上位（親なし）</option>
          {tree.map(({ cat, depth }) => (
            <option key={cat.id} value={String(cat.id)}>{categoryOptionLabel(cat, depth)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="mt-3 w-full rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {create.isPending ? "追加中…" : "追加"}
        </button>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="mt-4 flex flex-col gap-2">
          {categories.length === 0 && (
            <p className="text-sm" style={{ color: "var(--dim)" }}>まだカテゴリがありません。</p>
          )}
          {tree.map(({ cat, depth }) => (
            <div key={cat.id} style={{ marginLeft: depth * 20 }}>
              {editing?.id === cat.id ? (
                <div className="rounded-2xl px-3 py-3" style={{ background: "var(--surface-alt)" }}>
                  <label className="block text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor={`category-edit-name-${cat.id}`}>
                    カテゴリ名
                  </label>
                  <input
                    id={`category-edit-name-${cat.id}`}
                    {...FIELDS.updateCategory.name}
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); setError(""); }}
                    className="mt-1 w-full rounded-xl px-3 py-2"
                    style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
                  />
                  <label className="mt-3 block text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor={`category-edit-parent-${cat.id}`}>
                    親カテゴリ
                  </label>
                  <select
                    id={`category-edit-parent-${cat.id}`}
                    value={editParentId === null ? "" : String(editParentId)}
                    onChange={(e) => setEditParentId(e.target.value === "" ? null : Number(e.target.value))}
                    className="mt-1 w-full rounded-xl px-3 py-2"
                    style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
                  >
                    <option value="">最上位（親なし）</option>
                    {tree.filter(({ cat: c }) => !editBlockedIds.has(c.id)).map(({ cat: c, depth: d }) => (
                      <option key={c.id} value={String(c.id)}>{categoryOptionLabel(c, d)}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>自分自身と自分の子カテゴリは親に選べません。</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setError(""); }}
                      className="flex-1 rounded-full px-3 py-2 text-sm font-bold"
                      style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={submitEdit}
                      disabled={update.isPending}
                      className="flex-1 rounded-full px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                      style={{ background: "var(--accent)" }}
                    >
                      {update.isPending ? "保存中…" : "保存する"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: "var(--surface-alt)" }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" style={{ color: "var(--text)" }}>
                      {depth > 0 && <span aria-hidden="true" style={{ color: "var(--dim)" }}>└ </span>}
                      {cat.name}
                    </span>
                    <span className="block truncate text-xs" style={{ color: "var(--dim)" }}>
                      {cat.parent_id != null ? `親: ${nameById.get(cat.parent_id) ?? "（不明）"}` : "最上位"}
                    </span>
                  </span>
                  {confirmDelete?.id === cat.id ? (
                    <>
                      <span className="shrink-0 text-xs" style={{ color: "var(--danger)" }}>
                        削除しますか？{childCountOf(cat.id) > 0 ? `子カテゴリは${cat.parent_id != null ? `「${nameById.get(cat.parent_id) ?? ""}」` : "最上位"}の下へ移動します。` : ""}
                      </span>
                      <button
                        type="button"
                        disabled={del.isPending}
                        onClick={() => del.mutate(cat.id)}
                        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                        style={{ background: "var(--danger)" }}
                      >
                        削除する
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
                        style={{ background: "var(--surface)", color: "var(--text)" }}
                      >
                        やめる
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(cat)}
                        aria-label={`カテゴリ「${cat.name}」を編集`}
                        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
                        style={{ background: "var(--surface)", color: "var(--text)" }}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => { setConfirmDelete(cat); setEditing(null); setError(""); }}
                        aria-label={`カテゴリ「${cat.name}」を削除`}
                        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
                        style={{ background: "var(--surface)", color: "var(--danger)" }}
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** キャラへカテゴリを割り当てるシート（キャラの設定メニューから開く）。複数選択可。 */
function CategoryAssignSheet({
  character,
  categories,
  onClose,
}: {
  character: CharacterItem;
  categories: CategoryItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const rawInitialIds: number[] = character.category_ids ?? (character.category_id != null ? [character.category_id] : []);
  // 初期表示も祖先除外ルールでそろえる（子と祖先が両方付いた古いデータは子だけ表示）。
  const initialIds: number[] = pruneAncestorCategoryIds(categories, rawInitialIds);
  const [selectedIds, setSelectedIds] = useState<number[]>(initialIds);
  const assign = useMutation({
    mutationFn: async (ids: number[]) => await api.setCharacterCategories({ character_id: character.id, category_ids: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "設定に失敗しました"),
  });
  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // 子カテゴリを付けたら、付いていた祖先カテゴリは自動で外す（v1.27）。
      const ancestors = categoryAncestorIdSet(categories, id);
      return [...prev.filter((x) => !ancestors.has(x)), id];
    });
    setError("");
  };
  // 選択中の子孫カテゴリがあるカテゴリ（祖先側）は選べない。
  const blockingChildName = (id: number): string | null => {
    for (const sid of selectedIds) {
      if (sid !== id && categoryAncestorIdSet(categories, sid).has(id)) {
        return categories.find((c) => c.id === sid)?.name ?? null;
      }
    }
    return null;
  };
  const isDirty = [...selectedIds].sort((a, b) => a - b).join(",") !== [...initialIds].sort((a, b) => a - b).join(",");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={`${character.display_name}のカテゴリを設定`}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-center gap-3">
          <Avatar imageUrl={character.image_url} name={character.display_name} themeColor={character.theme_color} size={40} />
          <h2 className="font-display min-w-0 flex-1 truncate text-lg font-bold" style={{ color: "var(--text)" }}>{character.display_name}のカテゴリ</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          複数のカテゴリを選べます。複数に登録したキャラは、どのカテゴリで絞り込んでも表示されます。子カテゴリに登録したキャラは、その親カテゴリで絞り込んだ時にも表示されます。ただし、子カテゴリとその親カテゴリは同時には選べません（子を選ぶと親は自動で外れます）。何も選ばなければ未分類になります。
        </p>
        {categories.length === 0 && (
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
            まだカテゴリが登録されていません。一覧の「カテゴリ管理」から先にカテゴリを追加してください。
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2" role="group" aria-label="カテゴリの選択（複数選択可）">
          {categoryTreeEntries(categories).map(({ cat, depth }) => {
            const selected = selectedIds.includes(cat.id);
            // 子孫カテゴリが選択中なら、この祖先カテゴリは選択できない（v1.27）。
            const blockedBy = selected ? null : blockingChildName(cat.id);
            const disabled = blockedBy !== null;
            return (
              <label
                key={cat.id}
                className="flex items-center gap-3 rounded-2xl px-4 py-3"
                style={{
                  background: selected ? "var(--accent-soft)" : "var(--surface-alt)",
                  color: "var(--text)",
                  outline: selected ? "2px solid var(--accent)" : "none",
                  marginLeft: depth * 20,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggle(cat.id)}
                  aria-label={`カテゴリ「${cat.name}」`}
                  className="h-5 w-5 shrink-0"
                  style={{ accentColor: "var(--accent)" }}
                />
                <span className="font-bold">
                  {depth > 0 && <span aria-hidden="true" style={{ color: "var(--dim)" }}>└ </span>}
                  {cat.name}
                </span>
                {selected && <span className="ml-auto text-xs font-bold" style={{ color: "var(--accent)" }}>選択中</span>}
                {disabled && (
                  <span className="ml-auto text-right text-xs" style={{ color: "var(--dim)" }}>
                    子カテゴリ「{blockedBy}」を選択中のため選べません
                  </span>
                )}
              </label>
            );
          })}
          {categories.length > 0 && selectedIds.length === 0 && (
            <p className="px-1 text-xs" style={{ color: "var(--dim)" }}>現在は未分類です（カテゴリ未選択）。</p>
          )}
        </div>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full px-4 py-2.5 font-bold"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => assign.mutate(selectedIds)}
            disabled={assign.isPending || !isDirty}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {assign.isPending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ review (v1.5)

type ReviewHistoryData = ApiResponse<typeof api, "getReviewHistory">;

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "処理待ち",
  processing: "見直し中",
  done: "完了（自動適用済み）",
  no_change: "変更なし",
  failed: "失敗",
};

const REVIEW_FAIL_REASONS: Record<string, string> = {
  timeout: "タイムアウト（10分以内に見直しが終わりませんでした）",
  rate_limited: "Claudeの利用上限に達しました",
  generation_error: "生成に失敗しました",
  invalid_json: "見直し結果がJSONとして読み取れませんでした",
  invalid_format: "見直し結果の形式が avatar-profile ではありませんでした",
  name_mismatch: "見直し結果のキャラクター名が対象と一致しませんでした",
  id_mismatch: "見直し結果のプロファイルIDが元のものと変わっていました",
  invalid_profile: "見直し結果から設定を構築できませんでした",
  no_source_json: "元の設定JSONが保持されていないため、見直しできませんでした",
  character_not_found: "キャラクターが見つかりませんでした",
};

function reviewFailLabel(reason: string): string {
  return REVIEW_FAIL_REASONS[reason] ?? (reason ? `見直しに失敗しました（${reason}）` : "見直しに失敗しました");
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** レビューモードの切替ボタン。通常モードでは目立たないよう低コントラストで小さく表示する。 */
function ReviewModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className="rounded-full px-2.5 py-1 text-xs"
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        color: "var(--dim)",
        border: "1px solid var(--border)",
        opacity: active ? 1 : 0.6,
      }}
    >
      レビューモード{active ? " ON" : ""}
    </button>
  );
}

/** 選択した発言への指摘を書くパネル。 */
function ReviewPanel({
  speakerName,
  messageBody,
  busy,
  error,
  onSubmit,
  onCancel,
  onOpenHistory,
}: {
  speakerName: string;
  messageBody: string;
  busy: boolean;
  error: string;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  onOpenHistory: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [localError, setLocalError] = useState("");
  return (
    <div className="mb-2 rounded-2xl p-3" style={{ background: "var(--surface)", border: "1.5px solid var(--accent)" }} role="form" aria-label="レビューの指摘を書く">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold" style={{ color: "var(--dim)" }}>レビュー対象（{speakerName}の発言）</p>
        <button type="button" onClick={onCancel} aria-label="レビューの選択をやめる" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>
          ×
        </button>
      </div>
      <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{messageBody}</p>
      <label className="mt-3 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="review-feedback">
        設定と異なっている点
      </label>
      <textarea
        id="review-feedback"
        {...FIELDS.submitReview.feedback}
        value={feedback}
        onChange={(e) => { setFeedback(e.target.value); setLocalError(""); }}
        rows={3}
        placeholder="例: 一人称は「オレ様」のはずが「ボク」になっている"
        className="mt-1 w-full rounded-2xl p-3 text-sm"
        style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
      />
      {(localError || error) && <p className="mt-1 text-sm" style={{ color: "var(--danger)" }}>{localError || error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!feedback.trim()) { setLocalError("指摘を入力してください。"); return; }
            onSubmit(feedback.trim());
          }}
          className="rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "送信中…" : "レビューを送る"}
        </button>
        <button type="button" onClick={onOpenHistory} className="rounded-full px-3 py-2 text-xs font-bold" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>
          このキャラのレビュー履歴
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        送信すると、AIがキャラ設定を見直して自動で適用します。結果と差分はレビュー履歴に残ります。
      </p>
    </div>
  );
}

/** キャラごとのレビュー履歴シート。差分・再出力JSON・取り消しを含む。 */
function ReviewHistorySheet({ characterId, characterName, onClose }: { characterId: number; characterName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["reviewHistory", characterId],
    queryFn: () => api.getReviewHistory({ character_id: characterId }),
    refetchInterval: 10000,
  });
  const [confirmRevertId, setConfirmRevertId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [revertError, setRevertError] = useState("");
  const revert = useMutation({
    mutationFn: async (revisionId: number) => await api.revertRevision({ revision_id: revisionId }),
    onSuccess: () => {
      setConfirmRevertId(null);
      setRevertError("");
      queryClient.invalidateQueries({ queryKey: ["reviewHistory", characterId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["chat"] });
      queryClient.invalidateQueries({ queryKey: ["group"] });
    },
    onError: (e) => setRevertError(e instanceof Error ? e.message : "取り消しに失敗しました"),
  });
  const copyJson = async (reviewId: number, json: string) => {
    try {
      await navigator.clipboard.writeText(json);
      setCopiedId(reviewId);
    } catch {
      setCopiedId(null);
    }
  };

  const reviews: ReviewHistoryData["reviews"] = history.data?.reviews ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={`${characterName}のレビュー履歴`}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>{characterName}のレビュー履歴</h2>
          <button type="button" onClick={onClose} aria-label="レビュー履歴を閉じる" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>
            ×
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
          指摘を受けてAIが見直した結果です。差分があった見直しは自動で設定に適用されています。適用済みの改訂は、変更前の設定へ取り消せます。
        </p>
        {history.isPending && <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {history.error && <p className="mt-4 text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>}
        {history.data && reviews.length === 0 && (
          <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>まだレビューはありません。レビューモードでキャラの発言を選んで指摘を送ると、ここに記録されます。</p>
        )}
        {revertError && <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{revertError}</p>}
        <div className="mt-4 flex flex-col gap-4">
          {reviews.map((r) => (
            <article key={r.id} className="rounded-2xl p-3" style={{ background: "var(--surface-alt)" }} aria-label={`レビュー ${formatDateTime(r.created_at)}`}>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-bold"
                  style={{
                    background: "var(--surface)",
                    color: r.status === "failed" ? "var(--danger)" : r.status === "done" ? "var(--gold)" : "var(--dim)",
                  }}
                >
                  {REVIEW_STATUS_LABELS[r.status] ?? r.status}
                </span>
                <span className="text-xs" style={{ color: "var(--dim)" }}>{formatDateTime(r.created_at)}・{r.target_kind === "group" ? "グループでの発言" : "1対1での発言"}</span>
                {r.revision?.reverted_at && (
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--danger)" }}>取り消し済み</span>
                )}
              </div>
              <p className="mt-2 text-xs font-bold" style={{ color: "var(--dim)" }}>対象の発言</p>
              <p className="mt-0.5 line-clamp-4 text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{r.message_body}</p>
              <p className="mt-2 text-xs font-bold" style={{ color: "var(--dim)" }}>指摘</p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{r.feedback}</p>
              {r.status === "failed" && (
                <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{reviewFailLabel(r.fail_reason)}（設定は変更されていません）</p>
              )}
              {r.status === "no_change" && (
                <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>見直しの結果、設定の変更はありませんでした。</p>
              )}
              {r.revision && (
                <>
                  <p className="mt-3 text-xs font-bold" style={{ color: "var(--dim)" }}>設定の差分（{r.revision.diff.length}件）</p>
                  <div className="mt-1 flex flex-col gap-2">
                    {r.revision.diff.map((d, i) => (
                      <div key={i} className="rounded-xl p-2.5" style={{ background: "var(--surface)" }}>
                        <p className="text-xs font-bold break-all" style={{ color: "var(--gold)" }}>{d.path}</p>
                        <p className="mt-1 text-xs whitespace-pre-wrap break-words" style={{ color: "var(--dim)" }}>
                          <span className="font-bold">変更前: </span>{d.before}
                        </p>
                        <p className="mt-1 max-h-40 overflow-y-auto text-xs whitespace-pre-wrap break-words" style={{ color: "var(--text)" }}>
                          <span className="font-bold">変更後: </span>{d.after}
                        </p>
                      </div>
                    ))}
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-bold" style={{ color: "var(--dim)" }}>再出力された設定JSON全文</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-xl p-3 text-xs whitespace-pre-wrap break-all" style={{ background: "var(--surface)", color: "var(--text)" }}>{r.revision.after_json}</pre>
                    <button
                      type="button"
                      onClick={() => copyJson(r.id, r.revision!.after_json)}
                      className="mt-2 rounded-full px-3 py-1.5 text-xs font-bold"
                      style={{ background: "var(--surface)", color: "var(--text)" }}
                    >
                      {copiedId === r.id ? "コピーしました" : "JSONをコピー"}
                    </button>
                  </details>
                  {!r.revision.reverted_at && (
                    confirmRevertId === r.revision.id ? (
                      <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface)" }}>
                        <p className="text-sm" style={{ color: "var(--text)" }}>この改訂を取り消して、変更前の設定に戻しますか？（この改訂より後の見直しも上書きされます）</p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => setConfirmRevertId(null)} className="flex-1 rounded-full px-3 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
                            やめる
                          </button>
                          <button
                            type="button"
                            disabled={revert.isPending}
                            onClick={() => revert.mutate(r.revision!.id)}
                            className="flex-1 rounded-full px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                            style={{ background: "var(--danger)" }}
                          >
                            取り消す
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setConfirmRevertId(r.revision!.id); setRevertError(""); }}
                        className="mt-3 rounded-full px-3 py-1.5 text-xs font-bold"
                        style={{ background: "var(--surface)", color: "var(--danger)" }}
                      >
                        この改訂を取り消す
                      </button>
                    )
                  )}
                  {r.revision.reverted_at && (
                    <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>{formatDateTime(r.revision.reverted_at)} に取り消され、変更前の設定に戻っています。</p>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ home

type CharSort = "added" | "gojuon" | "recent";

function loadCharSort(): CharSort {
  try {
    const v = window.localStorage.getItem("chara-chat.char-sort");
    return v === "gojuon" || v === "recent" ? v : "added";
  } catch {
    return "added";
  }
}

function loadCompact(): boolean {
  try {
    return window.localStorage.getItem("chara-chat.char-compact") === "1";
  } catch {
    return false;
  }
}

// 並び替え・簡易表示の選択は、画面遷移で HomeView がアンマウントされても
// 失われないようセッション内（モジュールスコープ）にも保持する（設計書 v1.8 / 4.8章）。
// localStorage は埋め込み表示で保持されないことがあり、サーバ値の反映は
// 一覧データの再取得タイミングに左右されるため、この画面で選んだ値を
// その場で正として保持し、一覧へ戻った時に即座にその並びで表示する。
let sessionSort: CharSort | null = null;
let sessionCompact: boolean | null = null;

// グループ一覧のページ位置（10件/ページ、設計書 v2.0 / A）。画面遷移で失われないようセッション内に保持する。
let sessionGroupPage = 0;

// 一覧上部のタブ（個人 / グループ）。選択中タブのチャットだけを一覧に表示する。
// 画面遷移で失われないようセッション内に保持する。
let sessionHomeTab: "personal" | "group" = "personal";

/** キャラが属するカテゴリID一覧（旧データ互換: category_ids が無ければ category_id から作る）。 */
function charCategoryIds(c: CharacterItem): number[] {
  if (Array.isArray(c.category_ids)) return c.category_ids;
  return c.category_id != null ? [c.category_id] : [];
}

/** 選択中の並び替えでキャラ配列を並べ替える（一覧とグループ作成で共用）。 */
function sortCharactersBy(list: CharacterItem[], sort: CharSort): CharacterItem[] {
  return [...list].sort((a, b) => {
    if (sort === "gojuon") {
      const byName = a.display_name.localeCompare(b.display_name, "ja");
      return byName !== 0 ? byName : a.id - b.id;
    }
    if (sort === "recent") {
      // 会話のあるキャラを最終発言時刻の新しい順に。会話が無いキャラは追加順で後ろ。
      if (a.last_activity_at && b.last_activity_at) {
        const byTime = b.last_activity_at.localeCompare(a.last_activity_at);
        return byTime !== 0 ? byTime : a.id - b.id;
      }
      if (a.last_activity_at) return -1;
      if (b.last_activity_at) return 1;
      return a.id - b.id;
    }
    return a.id - b.id; // 追加順（サーバも id 昇順で返す）
  });
}

function HomeView({ go }: { go: (v: View) => void }) {
  const queryClient = useQueryClient();
  const home = useQuery({ queryKey: ["home"], queryFn: () => api.listHome({}), refetchInterval: 20000 });
  const [showImport, setShowImport] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [confirmDeleteChar, setConfirmDeleteChar] = useState<CharacterItem | null>(null);
  const [imageEditChar, setImageEditChar] = useState<CharacterItem | null>(null);
  const [menuChar, setMenuChar] = useState<CharacterItem | null>(null);
  const [viewSettingsChar, setViewSettingsChar] = useState<CharacterItem | null>(null);
  const [editSettingsChar, setEditSettingsChar] = useState<CharacterItem | null>(null);
  const [renameChar, setRenameChar] = useState<CharacterItem | null>(null);
  const [categoryAssignChar, setCategoryAssignChar] = useState<CharacterItem | null>(null);
  const [showCategoryManage, setShowCategoryManage] = useState(false);
  // カテゴリ絞り込み: "all" = 全て表示 / "none" = 未分類のみ / 数値 = そのカテゴリのみ。
  const [categoryFilter, setCategoryFilter] = useState<"all" | "none" | number>("all");
  const [sort, setSort] = useState<CharSort>(() => sessionSort ?? loadCharSort());
  const [compact, setCompact] = useState<boolean>(() => sessionCompact ?? loadCompact());
  // 一覧上部のタブ: 個人（キャラとの1対1）/ グループ。選んだ方のチャットだけ表示する。
  const [homeTab, setHomeTab] = useState<"personal" | "group">(sessionHomeTab);
  const changeHomeTab = (t: "personal" | "group") => {
    sessionHomeTab = t;
    setHomeTab(t);
  };
  // グループ一覧のページ（10件/ページ、設計書 v2.0 / A）。
  const [groupPage, setGroupPage] = useState(sessionGroupPage);
  const changeGroupPage = (p: number) => {
    sessionGroupPage = p;
    setGroupPage(p);
  };
  // スケジューリング（設計書 v2.0 / B）: 一覧と編集シート。
  const schedulesQuery = useQuery({ queryKey: ["schedules"], queryFn: () => api.listSchedules({}), refetchInterval: 30000 });
  const [scheduleSheet, setScheduleSheet] = useState<{ mode: "create" } | { mode: "edit"; schedule: ScheduleItem } | null>(null);
  // 全体設定（v2.1）: 返信が届いたらClaudeへ通知する ON/OFF。サーバ側（meta）に保存する。
  const globalSettings = useQuery({ queryKey: ["global-settings"], queryFn: () => api.getGlobalSettings({}) });
  const saveGlobalSettings = useMutation({
    mutationFn: async (v: { notify_reply: boolean }) => await api.saveGlobalSettings(v),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["global-settings"] }),
  });

  // 並び替え・簡易表示の選択はサーバ側（meta）にも保存し、次回開いた時に復元する。
  // この端末の localStorage は埋め込み表示では保持されないことがあるため、
  // サーバ保存を正とする。利用者がこの画面で変更した後は、サーバ値で上書きしない。
  // あわせてセッション内ストアと一覧キャッシュにも即時反映し、チャット画面へ
  // 遷移して戻った時も手動更新なしで選択中の並び順で表示されるようにする
  // （設計書 v1.8 / 4.8章）。
  const prefsTouchedRef = useRef(sessionSort !== null || sessionCompact !== null);
  const savePrefs = useMutation({
    mutationFn: async (p: { char_sort: CharSort; char_compact: boolean }) => await api.saveListPrefs(p),
  });
  const serverSort = home.data?.char_sort;
  const serverCompact = home.data?.char_compact;
  useEffect(() => {
    if (prefsTouchedRef.current || serverSort === undefined || serverCompact === undefined) return;
    sessionSort = serverSort;
    sessionCompact = serverCompact;
    setSort(serverSort);
    setCompact(serverCompact);
    try {
      window.localStorage.setItem("chara-chat.char-sort", serverSort);
      window.localStorage.setItem("chara-chat.char-compact", serverCompact ? "1" : "0");
    } catch { /* ローカル保存は補助。失敗してもサーバ値で表示する */ }
  }, [serverSort, serverCompact]);

  const changeSort = (v: CharSort) => {
    prefsTouchedRef.current = true;
    sessionSort = v;
    setSort(v);
    try { window.localStorage.setItem("chara-chat.char-sort", v); } catch { /* 保存できなくても並び替え自体は効く */ }
    // 一覧キャッシュにも即時反映する（戻ってきた時に古い値で上書きされないように）。
    queryClient.setQueryData<Home>(["home"], (old) => (old ? { ...old, char_sort: v } : old));
    savePrefs.mutate({ char_sort: v, char_compact: compact });
  };
  const changeCompact = (v: boolean) => {
    prefsTouchedRef.current = true;
    sessionCompact = v;
    setCompact(v);
    try { window.localStorage.setItem("chara-chat.char-compact", v ? "1" : "0"); } catch { /* 同上 */ }
    queryClient.setQueryData<Home>(["home"], (old) => (old ? { ...old, char_compact: v } : old));
    savePrefs.mutate({ char_sort: sort, char_compact: v });
  };

  // 会話を開く時は、一覧キャッシュの未読をその場で0にしてから遷移する。
  // サーバ側の既読化は会話画面の状態取得でも行われるが、一覧へ戻った時に
  // キャッシュの古い未読件数が残ってバッジが消えない事象への対策として、
  // 遷移時点で楽観的に消し、裏で再取得してサーバ値と一致させる。
  const openView = (v: View) => {
    if (v.kind === "chat") {
      queryClient.setQueryData<Home>(["home"], (old) =>
        old ? { ...old, characters: old.characters.map((c) => (c.id === v.characterId ? { ...c, unread_count: 0 } : c)) } : old,
      );
    } else if (v.kind === "group") {
      queryClient.setQueryData<Home>(["home"], (old) =>
        old ? { ...old, groups: old.groups.map((g) => (g.id === v.groupId ? { ...g, unread_count: 0 } : g)) } : old,
      );
    }
    go(v);
  };

  const deleteChar = useMutation({
    mutationFn: async (id: number) => await api.deleteCharacter({ character_id: id }),
    onSuccess: () => {
      setConfirmDeleteChar(null);
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const importKick = useMutation({
    mutationFn: async () => await api.requestImport({}),
  });

  if (home.isPending) {
    return <p className="px-4 py-12 text-center text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>;
  }
  if (home.error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>
        <button type="button" onClick={() => home.refetch()} className="mt-3 rounded-full px-5 py-2 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
          再読み込み
        </button>
      </div>
    );
  }
  const { characters, groups, categories } = home.data;
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  // グループ一覧は更新された順（最終発言時刻の降順。自動生成分も含む）に並べ、
  // 10件ごとにページ分けする（設計書 v2.0 / A）。個人一覧は従来通り。
  const GROUP_PAGE_SIZE = 10;
  const sortedGroups = [...groups].sort((a, b) =>
    b.last_activity_at !== a.last_activity_at
      ? b.last_activity_at.localeCompare(a.last_activity_at)
      : a.id - b.id,
  );
  const groupPageCount = Math.max(1, Math.ceil(sortedGroups.length / GROUP_PAGE_SIZE));
  const safeGroupPage = Math.min(groupPage, groupPageCount - 1);
  const pageGroups = sortedGroups.slice(safeGroupPage * GROUP_PAGE_SIZE, safeGroupPage * GROUP_PAGE_SIZE + GROUP_PAGE_SIZE);

  // カテゴリ絞り込み＋並び替えを適用した表示用リスト（v1.25、階層対応 v1.26）。
  // カテゴリは複数設定できるため、絞り込みは「そのカテゴリ（子孫カテゴリを含む）に
  // 属するか」で判定する（charMatchesCategory）。親カテゴリを選ぶと、その子・孫
  // カテゴリのキャラも表示される。「すべて」は全員を並び替えだけでフラットに
  // 表示する。「未分類」はカテゴリが1つも無いキャラ。
  // グループ作成のキャラ選択はこの一覧設定とは独立（シート内でカテゴリ絞り込みを持ち、
  // 並びは常に五十音順。v1.23）。
  const displayedCharacters: CharacterItem[] = (() => {
    if (categoryFilter === "none") return sortCharactersBy(characters.filter((c) => charCategoryIds(c).length === 0), sort);
    if (categoryFilter !== "all") return sortCharactersBy(characters.filter((c) => charMatchesCategory(c, categories, categoryFilter)), sort);
    return sortCharactersBy(characters, sort);
  })();

  // キャラ1件の描画（簡易表示の行／カード表示）。
  const renderCharRow = (c: CharacterItem, showChip: boolean = true) => (
    <div key={c.id} className="relative flex items-center gap-3 rounded-2xl px-3 py-2" style={{ background: "var(--surface)" }}>
      {c.unread_count > 0 && (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: "var(--danger)" }} />
      )}
      <button
        type="button"
        onClick={() => openView({ kind: "chat", characterId: c.id, unreadFromSeq: c.first_unread_seq })}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`${c.display_name}とのチャットを開く${c.unread_count > 0 ? `（未読の返信${c.unread_count}件）` : ""}`}
      >
        <span className="relative shrink-0">
          <Avatar imageUrl={c.image_url} name={c.display_name} themeColor={c.theme_color} size={40} />
          {c.unread_count > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black text-white"
              style={{ background: "var(--danger)" }}
            >
              {c.unread_count}
            </span>
          )}
        </span>
        <span className="font-display min-w-0 flex-1 truncate text-base font-bold" style={{ color: "var(--text)" }}>{c.display_name}</span>
        {showChip && charCategoryIds(c).length > 0 && (
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            {charCategoryIds(c).map((cid) => categoryNameById.get(cid) ? (
              <span key={cid} className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>
                {categoryNameById.get(cid)}
              </span>
            ) : null)}
          </span>
        )}
        <StatusBadge status={c.request_status} />
        {c.unreplied_count > 0 && c.request_status === "none" && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--gold)" }}>
            未返信 {c.unreplied_count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setMenuChar(c)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
        aria-label={`${c.display_name}の設定`}
      >
        <GearIcon />
      </button>
      <button
        type="button"
        onClick={() => setConfirmDeleteChar(c)}
        aria-label={`${c.display_name}を削除`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
        style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
      >
        ×
      </button>
    </div>
  );

  const renderCharCard = (c: CharacterItem, showChip: boolean = true) => (
    <div key={c.id} className="relative rounded-3xl p-4" style={{ background: "var(--surface)" }}>
      {c.unread_count > 0 && (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 rounded-t-3xl" style={{ background: "var(--danger)" }} />
      )}
      <button
        type="button"
        onClick={() => openView({ kind: "chat", characterId: c.id, unreadFromSeq: c.first_unread_seq })}
        className="flex w-full flex-col items-center gap-2 text-center"
        aria-label={`${c.display_name}とのチャットを開く${c.unread_count > 0 ? `（未読の返信${c.unread_count}件）` : ""}`}
      >
        <span className="relative">
          <Avatar imageUrl={c.image_url} name={c.display_name} themeColor={c.theme_color} size={72} />
          {c.unread_count > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-black text-white"
              style={{ background: "var(--danger)" }}
            >
              {c.unread_count}
            </span>
          )}
        </span>
        <span className="font-display w-full truncate text-base font-bold" style={{ color: "var(--text)" }}>{c.display_name}</span>
        {showChip && charCategoryIds(c).length > 0 && (
          <span className="flex flex-wrap justify-center gap-1">
            {charCategoryIds(c).map((cid) => categoryNameById.get(cid) ? (
              <span key={cid} className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>
                {categoryNameById.get(cid)}
              </span>
            ) : null)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <StatusBadge status={c.request_status} />
          {c.unreplied_count > 0 && c.request_status === "none" && (
            <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--gold)" }}>
              未返信 {c.unreplied_count}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setConfirmDeleteChar(c)}
        aria-label={`${c.display_name}を削除`}
        className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full text-base"
        style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
      >
        ×
      </button>
      <button
        type="button"
        onClick={() => setMenuChar(c)}
        className="absolute top-2 left-2 flex h-9 w-9 items-center justify-center rounded-full"
        style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
        aria-label={`${c.display_name}の設定`}
      >
        <GearIcon />
      </button>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10">
      <div className="mt-4 flex rounded-full p-1" style={{ background: "var(--surface-alt)" }} role="tablist" aria-label="チャットの種類">
        {(
          [
            { key: "personal", label: "個人" },
            { key: "group", label: "グループ" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={homeTab === t.key}
            onClick={() => changeHomeTab(t.key)}
            className="flex-1 rounded-full px-4 py-2 font-bold"
            style={
              homeTab === t.key
                ? { background: "var(--surface)", color: "var(--text)", boxShadow: "0 1px 4px rgba(20,10,40,0.18)" }
                : { background: "transparent", color: "var(--dim)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {homeTab === "personal" && (
      <section aria-label="キャラクター">
        <div className="mt-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-black" style={{ color: "var(--text)" }}>キャラクター</h2>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="rounded-full px-4 py-2 text-sm font-bold"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            キャラを追加
          </button>
        </div>

        {characters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor="char-sort">並び替え</label>
            <select
              id="char-sort"
              value={sort}
              onChange={(e) => changeSort(e.target.value as CharSort)}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              <option value="added">追加順</option>
              <option value="gojuon">五十音順</option>
              <option value="recent">最近使用した順</option>
            </select>
            <button
              type="button"
              onClick={() => changeCompact(!compact)}
              aria-pressed={compact}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{
                background: compact ? "var(--accent-soft)" : "var(--surface)",
                color: compact ? "var(--accent)" : "var(--text)",
                border: "1px solid var(--border)",
              }}
            >
              簡易表示{compact ? " ON" : ""}
            </button>
            <label className="text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor="char-category-filter">カテゴリ</label>
            <select
              id="char-category-filter"
              value={categoryFilter === "all" ? "all" : categoryFilter === "none" ? "none" : String(categoryFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setCategoryFilter(v === "all" ? "all" : v === "none" ? "none" : Number(v));
              }}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              <option value="all">すべて</option>
              {categoryTreeEntries(categories).map(({ cat, depth }) => (
                <option key={cat.id} value={String(cat.id)}>{categoryOptionLabel(cat, depth)}</option>
              ))}
              <option value="none">未分類</option>
            </select>
            <button
              type="button"
              onClick={() => setShowCategoryManage(true)}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              カテゴリ管理
            </button>
          </div>
        )}

        {characters.length === 0 ? (
          <div className="mt-4 rounded-3xl p-5" style={{ background: "var(--surface)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
              まだキャラクターがいません。アバター総合管理のプロファイルを取り込むか、書き出しJSONを貼って追加できます。
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => importKick.mutate()}
                disabled={importKick.isPending}
                className="rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                アバター管理から一括取り込み
              </button>
              {importKick.isSuccess && (
                <p className="text-xs" style={{ color: "var(--dim)" }}>取り込みを開始しました。反映まで少し時間がかかります。この画面は自動で更新されます。</p>
              )}
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="rounded-full px-4 py-2.5 font-bold"
                style={{ background: "var(--surface-alt)", color: "var(--text)" }}
              >
                書き出しJSONで追加
              </button>
            </div>
          </div>
        ) : displayedCharacters.length === 0 ? (
          <p className="mt-4 rounded-3xl p-5 text-sm" style={{ background: "var(--surface)", color: "var(--dim)" }}>
            このカテゴリのキャラクターはいません。キャラの設定メニュー「カテゴリを設定」から分類できます。
          </p>
        ) : compact ? (
          <div className="mt-4 flex flex-col gap-2">
            {displayedCharacters.map((c) => renderCharRow(c))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {displayedCharacters.map((c) => renderCharCard(c))}
          </div>
        )}
      </section>
      )}

      {homeTab === "group" && (
      <>
      <section aria-label="グループチャット">
        <div className="mt-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-black" style={{ color: "var(--text)" }}>グループチャット</h2>
          <button
            type="button"
            onClick={() => setShowCreateGroup(true)}
            disabled={characters.length < 1}
            className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            グループを作る
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>
            キャラ同士の掛け合いを楽しむグループは、まだありません。1人から作れて、なりきり機能で自分も参加できます。
          </p>
        ) : (
          <>
          <div className="mt-3 flex flex-col gap-3">
            {pageGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => openView({ kind: "group", groupId: g.id, unreadFromSeq: g.first_unread_seq })}
                className="relative flex w-full items-center gap-3 rounded-3xl p-4 text-left"
                style={{ background: "var(--surface)" }}
                aria-label={`グループ「${g.name}」を開く${g.unread_count > 0 ? `（未読の返信${g.unread_count}件）` : ""}`}
              >
                {g.unread_count > 0 && (
                  <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 rounded-t-3xl" style={{ background: "var(--danger)" }} />
                )}
                <span className="flex -space-x-3">
                  {g.member_image_urls.slice(0, 3).map((url, i) => (
                    <Avatar key={i} imageUrl={url} name={g.member_names[i] ?? "?"} themeColor="" size={40} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-display block truncate font-bold" style={{ color: "var(--text)" }}>{g.name}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--dim)" }}>
                    {g.status === "dissolved" ? "解散済み（ログの閲覧のみ）" : g.member_names.join("・")}
                  </span>
                </span>
                {g.unread_count > 0 && (
                  <span
                    className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-black text-white"
                    style={{ background: "var(--danger)" }}
                  >
                    {g.unread_count}
                  </span>
                )}
                <StatusBadge status={g.request_status} />
                {g.unreplied_count > 0 && g.request_status === "none" && (
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--accent-soft)", color: "var(--gold)" }}>
                    未返信 {g.unreplied_count}
                  </span>
                )}
              </button>
            ))}
          </div>
          {groupPageCount > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => changeGroupPage(safeGroupPage - 1)}
                disabled={safeGroupPage === 0}
                aria-label="前のページ"
                className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40"
                style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                前のページ
              </button>
              <span className="text-xs font-bold" style={{ color: "var(--dim)" }}>
                {safeGroupPage + 1} / {groupPageCount} ページ（全{sortedGroups.length}件）
              </span>
              <button
                type="button"
                onClick={() => changeGroupPage(safeGroupPage + 1)}
                disabled={safeGroupPage >= groupPageCount - 1}
                aria-label="次のページ"
                className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40"
                style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                次のページ
              </button>
            </div>
          )}
          </>
        )}
      </section>

      <SchedulingSection
        data={schedulesQuery.data}
        isPending={schedulesQuery.isPending}
        isError={!!schedulesQuery.error}
        onRetry={() => schedulesQuery.refetch()}
        onCreate={() => setScheduleSheet({ mode: "create" })}
        onEdit={(s) => setScheduleSheet({ mode: "edit", schedule: s })}
      />
      </>
      )}

      <p className="mt-10 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        発言を送ると、連携済みのClaudeが分離した生成プロセスで自動で返信を書きます（数分かかることがあります）。返信に失敗した時は、送った文章が入力欄に戻るので、そのまま再送信できます。生成に渡される履歴は直近20発言までで、それより前の会話は参照されません。会話ログはこのアプリ内に保存されます。外部へのバックアップは無いため、アプリを削除するとログも消えます。
      </p>

      {/* 全体設定（v2.1）: 返信到着時のClaudeへの通知 ON/OFF。 */}
      <section aria-label="全体設定" className="mt-10">
        <h2 className="font-display text-base font-black" style={{ color: "var(--text)" }}>全体設定</h2>
        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={globalSettings.data?.notify_reply ?? false}
            disabled={globalSettings.isPending || saveGlobalSettings.isPending}
            onChange={(e) => saveGlobalSettings.mutate({ notify_reply: e.target.checked })}
            aria-label="返信が届いたらClaudeに通知する"
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          <span>
            <span className="block text-sm font-bold" style={{ color: "var(--text)" }}>返信が届いたらClaudeに通知する</span>
            <span className="mt-1 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              ONにすると、キャラからの返信（スケジューリングの自動生成も含む）が届いた時に、Claude側へメッセージが送られます。なお、Claudeのログイン切れ（トークン切れ）で生成に失敗した場合は、この設定がOFFでも通知されます。
            </span>
          </span>
        </label>
        {saveGlobalSettings.isError && (
          <p className="mt-2 text-xs font-bold" style={{ color: "var(--danger)" }}>設定の保存に失敗しました。もう一度お試しください。</p>
        )}
      </section>

      {/* 全体ログ（履歴ページ）への入口。目立たない形でページ下部に置く（設計書 v2.0 / D）。 */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => go({ kind: "logs" })}
          className="px-3 py-1.5 text-xs"
          style={{ color: "var(--dim)", opacity: 0.7 }}
        >
          履歴（全体ログ）
        </button>
      </div>

      {showImport && <ImportSheet onClose={() => setShowImport(false)} />}
      {showCreateGroup && (
        <CreateGroupSheet characters={characters} categories={categories} onClose={() => setShowCreateGroup(false)} go={openView} />
      )}
      {scheduleSheet && schedulesQuery.data && (
        <ScheduleEditSheet
          initial={scheduleSheet.mode === "edit" ? scheduleSheet.schedule : null}
          eligibleGroups={schedulesQuery.data.eligible_groups}
          categories={categories}
          onClose={() => setScheduleSheet(null)}
        />
      )}
      {showCategoryManage && (
        <CategoryManageSheet categories={categories} onClose={() => setShowCategoryManage(false)} />
      )}
      {menuChar && (
        <CharacterMenuSheet
          character={menuChar}
          onClose={() => setMenuChar(null)}
          onViewSettings={() => { setViewSettingsChar(menuChar); setMenuChar(null); }}
          onEditSettings={() => { setEditSettingsChar(menuChar); setMenuChar(null); }}
          onEditImage={() => { setImageEditChar(menuChar); setMenuChar(null); }}
          onRename={() => { setRenameChar(menuChar); setMenuChar(null); }}
          onSetCategory={() => { setCategoryAssignChar(menuChar); setMenuChar(null); }}
        />
      )}
      {categoryAssignChar && (
        <CategoryAssignSheet
          character={categoryAssignChar}
          categories={categories}
          onClose={() => setCategoryAssignChar(null)}
        />
      )}
      {viewSettingsChar && (
        <CharacterSettingsSheet characterId={viewSettingsChar.id} onClose={() => setViewSettingsChar(null)} />
      )}
      {editSettingsChar && (
        <CharacterSettingsEditSheet character={editSettingsChar} onClose={() => setEditSettingsChar(null)} />
      )}
      {renameChar && (
        <RenameCharacterSheet character={renameChar} onClose={() => setRenameChar(null)} />
      )}
      {imageEditChar && (
        <ImageEditSheet
          characterId={imageEditChar.id}
          characterName={imageEditChar.display_name}
          currentImageUrl={imageEditChar.image_url}
          onClose={() => setImageEditChar(null)}
        />
      )}
      {confirmDeleteChar && (
        <ConfirmSheet
          title={`${confirmDeleteChar.display_name}を削除しますか？`}
          body={"このキャラクターとの会話ログも一緒に削除されます。参加しているグループからは除外され、過去の発言は名前を残して保持されます。"}
          confirmLabel="削除する"
          busy={deleteChar.isPending}
          onCancel={() => setConfirmDeleteChar(null)}
          onConfirm={() => deleteChar.mutate(confirmDeleteChar.id)}
        />
      )}
    </main>
  );
}

// ------------------------------------------------------------------ scheduling (v2.0 / B)

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function scheduleSummary(s: ScheduleItem): string {
  const freq = s.frequency === "weekly"
    ? `毎週 ${s.weekdays.map((d) => WEEKDAY_LABELS[d] ?? "").filter(Boolean).join("・")}`
    : "毎日";
  const target = s.target_type === "existing"
    ? (s.target_group_name ? `グループ「${s.target_group_name}」` : "（対象グループなし）")
    : "毎回新規チャット";
  return `${freq} ${s.times.join("・")} ／ ${target}`;
}

/** グループ一覧の下部に置く「スケジューリング」セクション。スケジュールの一覧・有効/無効・編集・削除と、作成ボタンを出す。 */
function SchedulingSection({
  data,
  isPending,
  isError,
  onRetry,
  onCreate,
  onEdit,
}: {
  data: SchedulesData | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (s: ScheduleItem) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<ScheduleItem | null>(null);
  const [error, setError] = useState("");
  const toggle = useMutation({
    mutationFn: async (v: { id: number; enabled: boolean }) => await api.setScheduleEnabled(v),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "切り替えに失敗しました"),
  });
  const del = useMutation({
    mutationFn: async (id: number) => await api.deleteSchedule({ id }),
    onSuccess: () => {
      setConfirmDelete(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "削除に失敗しました"),
  });
  const schedules = data?.schedules ?? [];
  return (
    <section aria-label="スケジューリング" className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-black" style={{ color: "var(--text)" }}>スケジューリング</h2>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-full px-4 py-2 text-sm font-bold"
          style={{ background: "var(--surface-alt)", color: "var(--text)" }}
        >
          スケジュールを作成
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        決まった時刻になると、対象のグループチャットでキャラクター同士の会話を自動で生成します。スケジュールは複数作れます。
      </p>
      {isPending && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
      {isError && (
        <div className="mt-3">
          <p className="text-sm" style={{ color: "var(--danger)" }}>スケジュールの読み込みに失敗しました。</p>
          <button type="button" onClick={onRetry} className="mt-2 rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            再読み込み
          </button>
        </div>
      )}
      {data && schedules.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>まだスケジュールがありません。「スケジュールを作成」から追加できます。</p>
      )}
      <div className="mt-3 flex flex-col gap-3">
        {schedules.map((s) => (
          <div key={s.id} className="rounded-3xl p-4" style={{ background: "var(--surface)" }}>
            <div className="flex items-center gap-2">
              <span className="font-display min-w-0 flex-1 truncate font-bold" style={{ color: "var(--text)" }}>{s.name}</span>
              <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={toggle.isPending}
                  onChange={(e) => toggle.mutate({ id: s.id, enabled: e.target.checked })}
                  aria-label={`スケジュール「${s.name}」の有効・無効`}
                  className="h-5 w-5"
                  style={{ accentColor: "var(--accent)" }}
                />
                {s.enabled ? "有効" : "無効"}
              </label>
            </div>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{scheduleSummary(s)}</p>
            <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              {s.use_history ? "履歴を使う" : "履歴を使わない"}
              {s.target_type === "new" ? ` ／ カテゴリから${s.min_members}〜${s.max_members}人を抽選` : ""}
              {s.allow_guests ? " ／ ゲストあり" : ""}
              {s.allow_mobs ? " ／ モブあり" : ""}
              {s.target_type === "new" && s.allow_narration ? " ／ ナレーションあり" : ""}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => onEdit(s)}
                className="rounded-full px-4 py-1.5 text-sm font-bold"
                style={{ background: "var(--surface-alt)", color: "var(--text)" }}
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(s); setError(""); }}
                className="rounded-full px-4 py-1.5 text-sm font-bold"
                style={{ background: "var(--surface-alt)", color: "var(--danger)" }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      {confirmDelete && (
        <ConfirmSheet
          title={`スケジュール「${confirmDelete.name}」を削除しますか？`}
          body="このスケジュールでの自動生成は止まります。作成済みのグループや会話履歴は残ります。"
          confirmLabel="削除する"
          busy={del.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => del.mutate(confirmDelete.id)}
        />
      )}
    </section>
  );
}

/** スケジュールの作成・編集シート。スケジュール側ではキャラを指定しない（対象チャットの設定を参照するため）。新規チャット型の時だけカテゴリ・人数・背景情報を指定する。 */
function ScheduleEditSheet({
  initial,
  eligibleGroups,
  categories,
  onClose,
}: {
  initial: ScheduleItem | null;
  eligibleGroups: SchedulesData["eligible_groups"];
  categories: CategoryItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const F = FIELDS.createSchedule;
  const [name, setName] = useState(initial?.name ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [frequency, setFrequency] = useState<"daily" | "weekly">(initial?.frequency === "weekly" ? "weekly" : "daily");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [times, setTimes] = useState<string[]>(initial && initial.times.length ? initial.times : ["08:00"]);
  const [targetType, setTargetType] = useState<"existing" | "new">(initial?.target_type === "new" ? "new" : "existing");
  const [targetGroupId, setTargetGroupId] = useState<number | null>(initial?.target_group_id ?? null);
  const [categoryIds, setCategoryIds] = useState<number[]>(initial?.category_ids ?? []);
  const [minMembers, setMinMembers] = useState(initial?.min_members ?? 2);
  const [maxMembers, setMaxMembers] = useState(initial?.max_members ?? 4);
  const [allowGuests, setAllowGuests] = useState(initial?.allow_guests ?? false);
  const [allowMobs, setAllowMobs] = useState(initial?.allow_mobs ?? false);
  const [allowNarration, setAllowNarration] = useState(initial?.allow_narration ?? false);
  const [useHistory, setUseHistory] = useState(initial?.use_history ?? false);
  const [backgroundText, setBackgroundText] = useState(initial?.background_text ?? "");
  const [error, setError] = useState("");

  const buildPayload = () => ({
    name: name.trim(),
    enabled,
    frequency,
    weekdays,
    times: times.map((t) => t.trim()).filter(Boolean),
    target_type: targetType,
    target_group_id: targetType === "existing" ? targetGroupId : null,
    category_ids: categoryIds,
    min_members: minMembers,
    max_members: maxMembers,
    allow_guests: allowGuests,
    allow_mobs: allowMobs,
    allow_narration: allowNarration,
    use_history: useHistory,
    background_text: backgroundText,
  });
  const save = useMutation({
    mutationFn: async () => {
      const p = buildPayload();
      return initial ? await api.updateSchedule({ id: initial.id, ...p }) : await api.createSchedule(p);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  const submit = () => {
    if (!name.trim()) { setError("スケジュール名を入力してください。"); return; }
    if (times.map((t) => t.trim()).filter(Boolean).length === 0) { setError("生成時刻を1つ以上入れてください。"); return; }
    if (frequency === "weekly" && weekdays.length === 0) { setError("曜日を1つ以上選んでください。"); return; }
    if (targetType === "existing" && targetGroupId == null) { setError("対象のグループチャットを選んでください。"); return; }
    if (targetType === "new" && categoryIds.length === 0) { setError("カテゴリを1つ以上選んでください。"); return; }
    if (minMembers > maxMembers) { setError("人数の最小は最大以下にしてください。"); return; }
    setError("");
    save.mutate();
  };
  // 対象グループの選択肢。編集時に現在の対象が選択肢（なりきり無効・解散していない
  // グループ）に無い場合は、現状が分かるよう注記つきで1件追加する。
  const groupOptions = [...eligibleGroups];
  if (initial?.target_group_id != null && !groupOptions.some((g) => g.id === initial.target_group_id)) {
    groupOptions.push({ id: initial.target_group_id, name: `${initial.target_group_name ?? "（不明なグループ）"}（現在は対象に選べません）` });
  }
  const toggleWeekday = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  const toggleCategory = (id: number) =>
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label={initial ? "スケジュールを編集" : "スケジュールを作成"}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>{initial ? "スケジュールを編集" : "スケジュールを作成"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
            style={{ background: "var(--surface-alt)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>

        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="schedule-name">
          スケジュール名（必須）
        </label>
        <input
          id="schedule-name"
          {...F.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 朝の雑談"
          className="mt-1 w-full rounded-2xl px-3 py-2.5"
          style={editInputStyle}
        />
        <label className="mt-3 flex items-center gap-2 text-sm font-bold" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5" style={{ accentColor: "var(--accent)" }} />
          このスケジュールを有効にする
        </label>

        <p className="mt-5 text-sm font-bold" style={{ color: "var(--text)" }}>生成スケジュール</p>
        <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="頻度">
          {(
            [
              { key: "daily", label: "毎日" },
              { key: "weekly", label: "毎週" },
            ] as const
          ).map((o) => (
            <label key={o.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: frequency === o.key ? "var(--accent-soft)" : "transparent" }}>
              <input type="radio" name="schedule-frequency" checked={frequency === o.key} onChange={() => setFrequency(o.key)} aria-label={o.label} className="h-5 w-5 shrink-0" />
              <span className="font-bold" style={{ color: "var(--text)" }}>{o.label}</span>
            </label>
          ))}
        </div>
        {frequency === "weekly" && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="曜日（複数選択可）">
            {WEEKDAY_LABELS.map((label, d) => {
              const on = weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  aria-pressed={on}
                  aria-label={`曜日: ${label}`}
                  className="h-10 w-10 rounded-full text-sm font-bold"
                  style={
                    on
                      ? { background: "var(--accent)", color: "#fff" }
                      : { background: "var(--surface-alt)", color: "var(--text)" }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>生成時刻（複数選択可・日本時間）</p>
        <div className="mt-2 flex flex-col gap-2">
          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={t}
                onChange={(e) => setTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`生成時刻${i + 1}`}
                className="rounded-2xl px-3 py-2.5"
                style={editInputStyle}
              />
              {times.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`生成時刻${i + 1}を削除`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base"
                  style={{ background: "var(--surface-alt)", color: "var(--danger)" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {times.length < 10 && (
            <button
              type="button"
              onClick={() => setTimes((prev) => [...prev, "12:00"])}
              className="self-start rounded-full px-4 py-2 text-sm font-bold"
              style={{ background: "var(--surface-alt)", color: "var(--text)" }}
            >
              ＋ 時刻を追加
            </button>
          )}
        </div>

        <p className="mt-5 text-sm font-bold" style={{ color: "var(--text)" }}>対象</p>
        <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="対象の種類">
          {(
            [
              { key: "existing", label: "既存のグループチャット", desc: "選んだグループの設定（参加者・ゲスト/モブ・ナレーション・背景情報）を使って、その中で会話を生成します" },
              { key: "new", label: "毎回新規チャット", desc: "実行のたびに新しいグループを作り、カテゴリから抽選したキャラで会話を生成します" },
            ] as const
          ).map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-3 rounded-2xl px-2 py-2" style={{ background: targetType === o.key ? "var(--accent-soft)" : "transparent" }}>
              <input type="radio" name="schedule-target-type" checked={targetType === o.key} onChange={() => setTargetType(o.key)} aria-label={o.label} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block font-bold" style={{ color: "var(--text)" }}>{o.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{o.desc}</span>
              </span>
            </label>
          ))}
        </div>

        {targetType === "existing" && (
          <div className="mt-3">
            <label className="block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="schedule-target-group">
              対象のグループチャット
            </label>
            <select
              id="schedule-target-group"
              value={targetGroupId === null ? "" : String(targetGroupId)}
              onChange={(e) => setTargetGroupId(e.target.value === "" ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-2xl px-3 py-2.5"
              style={editInputStyle}
            >
              <option value="">選んでください</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={String(g.id)}>{g.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              なりきり設定が有効なグループは対象にできません。背景情報はグループ側の設定を使います。
            </p>
          </div>
        )}

        {targetType === "new" && (
          <div className="mt-3">
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>抽選するカテゴリ（複数選択可）</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              選んだカテゴリ（子カテゴリを含む）に属するキャラクターの中から抽選します。未分類のキャラクターは対象になりません。
            </p>
            {categories.length === 0 && (
              <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>まだカテゴリが登録されていません。一覧の「カテゴリ管理」から先にカテゴリを追加してください。</p>
            )}
            <div className="mt-2 flex flex-col gap-2" role="group" aria-label="カテゴリの選択（複数選択可）">
              {categoryTreeEntries(categories).map(({ cat, depth }) => {
                const selected = categoryIds.includes(cat.id);
                return (
                  <label
                    key={cat.id}
                    className="flex items-center gap-3 rounded-2xl px-4 py-3"
                    style={{
                      background: selected ? "var(--accent-soft)" : "var(--surface-alt)",
                      color: "var(--text)",
                      outline: selected ? "2px solid var(--accent)" : "none",
                      marginLeft: depth * 20,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleCategory(cat.id)}
                      aria-label={`カテゴリ「${cat.name}」`}
                      className="h-5 w-5 shrink-0"
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span className="font-bold">
                      {depth > 0 && <span aria-hidden="true" style={{ color: "var(--dim)" }}>└ </span>}
                      {cat.name}
                    </span>
                    {selected && <span className="ml-auto text-xs font-bold" style={{ color: "var(--accent)" }}>選択中</span>}
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <label className="text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="schedule-min-members">人数</label>
              <select
                id="schedule-min-members"
                value={String(minMembers)}
                onChange={(e) => setMinMembers(Number(e.target.value))}
                aria-label="人数の最小"
                className="rounded-2xl px-3 py-2"
                style={editInputStyle}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={String(n)}>{n}人</option>
                ))}
              </select>
              <span style={{ color: "var(--dim)" }}>〜</span>
              <select
                value={String(maxMembers)}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                aria-label="人数の最大"
                className="rounded-2xl px-3 py-2"
                style={editInputStyle}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={String(n)}>{n}人</option>
                ))}
              </select>
            </div>
            <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>ゲスト・モブ・ナレーション（作成されるグループに引き継がれます）</p>
            <div className="mt-2 flex flex-col gap-1">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowGuests ? "var(--accent-soft)" : "transparent" }}>
                <input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} aria-label="ゲストを許可する" className="h-5 w-5 shrink-0" />
                <span className="font-bold" style={{ color: "var(--text)" }}>ゲストあり</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowMobs ? "var(--accent-soft)" : "transparent" }}>
                <input type="checkbox" checked={allowMobs} onChange={(e) => setAllowMobs(e.target.checked)} aria-label="モブを許可する" className="h-5 w-5 shrink-0" />
                <span className="font-bold" style={{ color: "var(--text)" }}>モブあり</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowNarration ? "var(--accent-soft)" : "transparent" }}>
                <input type="checkbox" checked={allowNarration} onChange={(e) => setAllowNarration(e.target.checked)} aria-label="ナレーションを許可する" className="h-5 w-5 shrink-0" />
                <span className="font-bold" style={{ color: "var(--text)" }}>ナレーションあり</span>
              </label>
            </div>
            <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }}>
              背景情報
              <textarea
                {...F.background_text}
                value={backgroundText}
                onChange={(e) => setBackgroundText(e.target.value)}
                rows={4}
                placeholder="例: 放課後の教室で、文化祭の準備をしている"
                className="mt-1 w-full rounded-2xl px-3 py-2.5 font-normal"
                style={editInputStyle}
              />
            </label>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              ここに書いた背景情報が正で、作成されるグループへ初期値としてコピーされます（グループ側で編集しても、こちらには戻りません）。
            </p>
          </div>
        )}

        <label className="mt-5 flex items-start gap-2 text-sm" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={useHistory} onChange={(e) => setUseHistory(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: "var(--accent)" }} />
          <span>
            <span className="font-bold">履歴を使う</span>
            <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
              {targetType === "existing"
                ? "オンにすると、そのグループの過去の会話を材料にして続きから話し始めます。オフでは履歴を送らず、背景情報だけを材料に話し始めます。"
                : "オンにすると、このスケジュールで前回作ったグループの会話を材料にして話し始めます（前回が無い・失敗した場合は履歴なしで始まります）。"}
            </span>
          </span>
        </label>

        {error && <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={save.isPending}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : initial ? "保存する" : "作成する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ app logs (v2.0 / D)

const LOG_KIND_LABELS: Record<string, string> = {
  user_send: "送信",
  generation: "生成",
  review: "レビュー",
  settings: "設定変更",
  auto: "自動生成",
};

function LogBody({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["app-log", id], queryFn: () => api.getAppLogBody({ id }) });
  if (q.isPending) return <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>;
  if (q.error) {
    return (
      <div className="mt-2">
        <p className="text-sm" style={{ color: "var(--danger)" }}>本文の読み込みに失敗しました。</p>
        <button type="button" onClick={() => q.refetch()} className="mt-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--text)" }}>
          再読み込み
        </button>
      </div>
    );
  }
  return (
    <pre className="mt-2 max-h-80 overflow-auto rounded-xl p-3 text-xs leading-relaxed whitespace-pre-wrap break-words" style={{ background: "var(--surface)", color: "var(--text)" }}>
      {q.data?.body || "（本文なし）"}
    </pre>
  );
}

/** 全体ログ（履歴ページ）。見出しのみの一覧で、タップした行だけ本文を個別に読み込んで開閉表示する。 */
function LogsView({ back }: { back: () => void }) {
  const logs = useQuery({ queryKey: ["app-logs"], queryFn: () => api.listAppLogs({}), refetchInterval: 20000 });
  const [openId, setOpenId] = useState<number | null>(null);
  const items: AppLogItem[] = logs.data?.logs ?? [];
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10">
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={back} aria-label="一覧へ戻る" className="flex h-10 w-10 items-center justify-center rounded-full text-xl" style={{ background: "var(--surface)", color: "var(--text)" }}>
          ←
        </button>
        <h2 className="font-display text-lg font-black" style={{ color: "var(--text)" }}>履歴（全体ログ）</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
        あなたの送信、生成に使ったプロンプトと生レスポンス、レビュー、キャラクター設定の変更、自動生成の記録です。新しい順に最大100件まで残ります（古い物から消えます）。見出しをタップすると本文を開きます。
      </p>
      {logs.isPending && <p className="mt-6 text-center text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
      {logs.error && (
        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>
          <button type="button" onClick={() => logs.refetch()} className="mt-3 rounded-full px-5 py-2 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            再読み込み
          </button>
        </div>
      )}
      {logs.data && items.length === 0 && (
        <p className="mt-6 rounded-3xl p-5 text-sm" style={{ background: "var(--surface)", color: "var(--dim)" }}>
          まだログがありません。チャットで送信したり、設定を変更したりすると、ここに記録されます。
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {items.map((l) => {
          const open = openId === l.id;
          return (
            <div key={l.id} className="rounded-2xl px-3 py-2.5" style={{ background: "var(--surface-alt)" }}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : l.id)}
                aria-expanded={open}
                aria-label={`ログ「${l.title}」の本文を${open ? "閉じる" : "開く"}`}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--dim)" }}>
                  {LOG_KIND_LABELS[l.kind] ?? l.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: "var(--text)" }}>{l.title}</span>
                <span className="shrink-0 text-xs" style={{ color: "var(--dim)" }}>{formatDateTime(l.created_at)}</span>
                <span aria-hidden="true" className="shrink-0 text-xs" style={{ color: "var(--dim)" }}>{open ? "▲" : "▼"}</span>
              </button>
              {open && <LogBody id={l.id} />}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const importChar = useMutation({
    mutationFn: async (text: string) => await api.importCharacter({ json: text }),
    onSuccess: (r) => {
      setDone(r.is_new ? `「${r.display_name}」を追加しました。` : `「${r.display_name}」の設定を更新しました（会話履歴は保持されています）。`);
      setJson("");
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "取り込みに失敗しました"),
  });
  const importKick = useMutation({ mutationFn: async () => await api.requestImport({}) });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="キャラクターを追加">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>キャラクターを追加</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          アバター総合管理アプリの書き出しJSON（avatar-profile形式）を貼ると、そのキャラクターを追加できます。同じプロファイルの再取り込みでは、設定だけが更新され、会話履歴は残ります。ここからの追加では画像は付きません（画像つきで取り込む場合は下の一括取り込みを使ってください）。
        </p>
        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="import-json">
          書き出しJSON
        </label>
        <textarea
          id="import-json"
          {...FIELDS.importCharacter.json}
          value={json}
          onChange={(e) => { setJson(e.target.value); setError(""); setDone(""); }}
          rows={8}
          placeholder='{"format": "avatar-profile", ...}'
          className="mt-1 w-full rounded-2xl p-3 text-xs"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        {done && <p className="mt-2 text-sm" style={{ color: "var(--gold)" }}>{done}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            閉じる
          </button>
          <button
            type="button"
            disabled={importChar.isPending}
            onClick={() => {
              if (!json.trim()) { setError("JSONを貼ってください。"); return; }
              importChar.mutate(json);
            }}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            取り込む
          </button>
        </div>
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => importKick.mutate()}
            disabled={importKick.isPending}
            className="w-full rounded-full px-4 py-2.5 font-bold disabled:opacity-50"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            アバター管理から一括取り込み（画像つき）
          </button>
          {importKick.isSuccess && (
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>取り込みを開始しました。反映まで少し時間がかかります。</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateGroupSheet({ characters, categories, onClose, go }: { characters: CharacterItem[]; categories: CategoryItem[]; onClose: () => void; go: (v: View) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [allowGuests, setAllowGuests] = useState(false);
  const [allowMobs, setAllowMobs] = useState(false);
  const [allowNarration, setAllowNarration] = useState(false);
  const [error, setError] = useState("");
  // シート内のカテゴリ絞り込み（v1.23、階層対応 v1.26）: "all" = 未指定（全員）/
  // "none" = 未分類のみ / 数値 = そのカテゴリ（子孫カテゴリを含む）。
  // 一覧側の絞り込み・並び替え設定とは独立に持ち、並びは設定に関わらず常に五十音順にする。
  const [catFilter, setCatFilter] = useState<"all" | "none" | number>("all");
  const visibleCharacters = sortCharactersBy(
    characters.filter((c) => {
      if (catFilter === "all") return true;
      if (catFilter === "none") return charCategoryIds(c).length === 0;
      return charMatchesCategory(c, categories, catFilter);
    }),
    "gojuon",
  );
  const create = useMutation({
    mutationFn: async () => await api.createGroup({ name: name.trim(), character_ids: selected, allow_guests: allowGuests, allow_mobs: allowMobs, allow_narration: allowNarration }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      onClose();
      go({ kind: "group", groupId: r.id, unreadFromSeq: null });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "作成に失敗しました"),
  });
  const toggle = (id: number) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 8) { setError("グループは最大8人までです。"); return prev; }
      setError("");
      return [...prev, id];
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="グループを作る">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>グループを作る</h2>
        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="group-name">グループ名（任意）</label>
        <input
          id="group-name"
          {...FIELDS.createGroup.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="空欄なら参加キャラ名から自動で付けます"
          className="mt-1 w-full rounded-2xl px-3 py-2 text-sm"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>参加キャラクター（1〜8人）</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>1人だけでも作れます。作成後に「なりきり」を設定すると、自分がそのキャラとして参加できます。</p>
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor="group-create-category-filter">カテゴリ</label>
            <select
              id="group-create-category-filter"
              value={catFilter === "all" ? "all" : catFilter === "none" ? "none" : String(catFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setCatFilter(v === "all" ? "all" : v === "none" ? "none" : Number(v));
              }}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              <option value="all">すべて</option>
              {categoryTreeEntries(categories).map(({ cat, depth }) => (
                <option key={cat.id} value={String(cat.id)}>{categoryOptionLabel(cat, depth)}</option>
              ))}
              <option value="none">未分類</option>
            </select>
            <span className="text-xs" style={{ color: "var(--dim)" }}>選択中 {selected.length}人</span>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-1">
          {visibleCharacters.map((c) => (
            <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: selected.includes(c.id) ? "var(--accent-soft)" : "transparent" }}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                aria-label={`${c.display_name}を参加させる`}
                className="h-5 w-5 shrink-0"
              />
              <Avatar imageUrl={c.image_url} name={c.display_name} themeColor={c.theme_color} size={36} />
              <span className="font-bold" style={{ color: "var(--text)" }}>{c.display_name}</span>
            </label>
          ))}
          {visibleCharacters.length === 0 && (
            <p className="px-2 py-3 text-sm" style={{ color: "var(--dim)" }}>このカテゴリのキャラクターはいません。</p>
          )}
        </div>
        <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>ゲスト・モブ・ナレーション</p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>オンにすると、会話の流れに応じて参加者以外が混じることがあります（混じらないこともあります）。作成後もグループの設定から変えられます。</p>
        <div className="mt-2 flex flex-col gap-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowGuests ? "var(--accent-soft)" : "transparent" }}>
            <input
              type="checkbox"
              checked={allowGuests}
              onChange={(e) => setAllowGuests(e.target.checked)}
              aria-label="ゲストを許可する"
              className="h-5 w-5 shrink-0"
            />
            <span className="font-bold" style={{ color: "var(--text)" }}>ゲスト（参加していないキャラが名前つきで入ることがある）</span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowMobs ? "var(--accent-soft)" : "transparent" }}>
            <input
              type="checkbox"
              checked={allowMobs}
              onChange={(e) => setAllowMobs(e.target.checked)}
              aria-label="モブを許可する"
              className="h-5 w-5 shrink-0"
            />
            <span className="font-bold" style={{ color: "var(--text)" }}>モブ（住民・生徒などの名前のない人々が入ることがある）</span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: allowNarration ? "var(--accent-soft)" : "transparent" }}>
            <input
              type="checkbox"
              checked={allowNarration}
              onChange={(e) => setAllowNarration(e.target.checked)}
              aria-label="ナレーションを許可する"
              className="h-5 w-5 shrink-0"
            />
            <span className="font-bold" style={{ color: "var(--text)" }}>ナレーション（背景説明・場面転換・時間経過の説明が入ることがある）</span>
          </label>
        </div>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() => {
              if (selected.length < 1) { setError("キャラクターを1人以上選んでください。"); return; }
              create.mutate();
            }}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            作成する
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ chat

function ChatView({ characterId, unreadFromSeq, back }: { characterId: number; unreadFromSeq: number | null; back: () => void }) {
  const queryClient = useQueryClient();
  useLockBodyScroll();
  const state = useQuery({
    queryKey: ["chat", characterId],
    queryFn: () => api.getChatState({ character_id: characterId }),
    refetchInterval: 10000,
  });
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [failNotice, setFailNotice] = useState("");
  const [cancelNotice, setCancelNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showImageEdit, setShowImageEdit] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [showReviewHistory, setShowReviewHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const prevMsgCountRef = useRef(0);
  const msgCount = state.data?.messages.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !state.data) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      prevMsgCountRef.current = msgCount;
      // 「新着」区切りがある時は、開いた直後に区切りの位置が見えるようにする。
      if (unreadFromSeq != null && dividerRef.current) {
        // scrollIntoView は文書を含む全ての祖先スクロールを動かし画面全体が
        // ずれるため、このスクロール領域の中だけで区切りが中央に来るよう計算する。
        const target = dividerRef.current;
        const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += delta - (el.clientHeight - target.clientHeight) / 2;
        return;
      }
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (msgCount !== prevMsgCountRef.current) {
      prevMsgCountRef.current = msgCount;
      el.scrollTop = el.scrollHeight;
    }
  }, [msgCount, state.data, unreadFromSeq]);
  useDraftRestore(state.data?.draft, setDraft, setFailNotice);

  // 開いている間に新しい発言が見えたら、その都度サーバへ既読を明示する。
  // 一覧の新着バッジは遷移時に楽観的に消してあるが、開いたまま届いた返信も
  // 既読として確定させ、一覧へ戻った時にバッジが残らないようにする。
  const latestChatSeq = state.data?.messages[state.data.messages.length - 1]?.seq ?? 0;
  const markChatRead = useMutation({ mutationFn: async () => await api.markChatRead({ character_id: characterId }) });
  const markedChatSeqRef = useRef(0);
  const markChatReadMutate = markChatRead.mutate;
  useEffect(() => {
    if (latestChatSeq > markedChatSeqRef.current) {
      markedChatSeqRef.current = latestChatSeq;
      markChatReadMutate();
    }
  }, [latestChatSeq, markChatReadMutate]);

  const post = useMutation({
    mutationFn: async (body: string) => await api.postMessage({ character_id: characterId, body }),
    onSuccess: () => {
      setDraft("");
      setSendError("");
      setFailNotice("");
      setCancelNotice("");
      queryClient.invalidateQueries({ queryKey: ["chat", characterId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "送信に失敗しました"),
  });
  const cancelSend = useMutation({
    mutationFn: async () => await api.cancelPendingSend({ target_kind: "chat", target_id: characterId }),
    onSuccess: (res) => {
      if (res.cancelled) {
        // 取り消した文章を入力欄へ戻す。入力途中の文章があれば、その前に連結する。
        setDraft((prev) => (prev.trim() ? `${res.restored_text}\n${prev}` : res.restored_text));
        setFailNotice("");
        setSendError("");
        setCancelNotice("送信を取り消しました。文章を入力欄に戻しました。");
      } else {
        setCancelNotice("生成が始まっているため、取り消せませんでした。");
      }
      queryClient.invalidateQueries({ queryKey: ["chat", characterId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "取り消しに失敗しました"),
  });
  const clear = useMutation({
    mutationFn: async () => await api.clearChatHistory({ character_id: characterId }),
    onSuccess: () => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: ["chat", characterId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const submitReview = useMutation({
    mutationFn: async (args: { message_id: number; feedback: string }) =>
      await api.submitReview({ target_kind: "chat", target_id: characterId, message_id: args.message_id, feedback: args.feedback }),
    onSuccess: () => {
      setSelectedReviewId(null);
      setReviewError("");
      setReviewNotice("レビューを登録しました。見直しが終わると設定へ自動で反映されます。結果はレビュー履歴で確認できます。");
      queryClient.invalidateQueries({ queryKey: ["reviewHistory", characterId] });
    },
    onError: (e) => setReviewError(e instanceof Error ? e.message : "レビューの送信に失敗しました"),
  });

  const data: ChatState | undefined = state.data;
  const req = data?.request;
  const selectedReviewMsg = data?.messages.find((m) => m.id === selectedReviewId && m.speaker === "character") ?? null;

  // 返信待ち（pending / 生成中）の間は送信できない。取り消しボタンは
  // 生成が始まる前（pending の間）だけ、未確認の利用者発言の最後の発言の
  // 下に出す。生成が始まったら（processing）もう取り消せないので出さない。
  const waiting = req?.status === "pending" || req?.status === "processing";
  const chatUserMsgs = (data?.messages ?? []).filter((m) => m.speaker === "user");
  const unrepliedMsgs = req?.status === "pending" && req.origin !== "auto" && req.unreplied_count > 0 ? chatUserMsgs.slice(-req.unreplied_count) : [];
  const cancelTargetId = unrepliedMsgs.length ? unrepliedMsgs[unrepliedMsgs.length - 1]!.id : null;

  // 送信ボタンと Enter キーで共用する送信処理。
  const submitDraft = () => {
    if (post.isPending) return;
    if (waiting) { setSendError("返信が来るまで送信できません。"); return; }
    if (!draft.trim()) { setSendError("メッセージを入力してください。"); return; }
    post.mutate(draft.trim());
  };

  return (
    <div
      className="fixed top-0 right-0 left-0 mx-auto flex w-full max-w-2xl flex-col"
      style={{ height: "100dvh", background: "var(--bg)" }}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 pt-safe pb-2" style={{ background: "var(--bg)" }}>
        <button type="button" onClick={back} aria-label="一覧へ戻る" className="flex h-10 w-10 items-center justify-center rounded-full text-xl" style={{ background: "var(--surface)", color: "var(--text)" }}>
          ←
        </button>
        {data && (
          <>
            <Avatar imageUrl={data.character.image_url} name={data.character.display_name} themeColor={data.character.theme_color} size={40} />
            <h2 className="font-display min-w-0 flex-1 truncate text-lg font-black" style={{ color: "var(--text)" }}>{data.character.display_name}</h2>
            <button
              type="button"
              onClick={() => setShowImageEdit(true)}
              className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={{ background: "var(--surface)", color: "var(--dim)" }}
            >
              画像変更
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={{ background: "var(--surface)", color: "var(--dim)" }}
            >
              履歴クリア
            </button>
            <button
              type="button"
              onClick={() => setShowExport(true)}
              className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={{ background: "var(--surface)", color: "var(--dim)" }}
            >
              全文出力
            </button>
            <ReviewModeToggle
              active={reviewMode}
              onToggle={() => {
                setReviewMode((v) => !v);
                setSelectedReviewId(null);
                setReviewError("");
              }}
            />
          </>
        )}
      </header>

      {reviewMode && (
        <div className="mx-3 mt-1 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--surface)" }} role="status">
          <p className="min-w-0 flex-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
            レビューモード中です。キャラの発言をタップして選ぶと、設定と違う点を指摘できます。
          </p>
          <button
            type="button"
            onClick={() => setShowReviewHistory(true)}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--surface-alt)", color: "var(--text)" }}
          >
            レビュー履歴
          </button>
        </div>
      )}

      {req && <RequestBanner request={req} />}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-none px-3 py-3">
        {state.isPending && <p className="py-8 text-center text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {state.error && <p className="py-8 text-center text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>}
        {data && data.messages.length === 0 && (
          <p className="py-8 text-center text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
            まだ会話がありません。下の入力欄から話しかけてみてください。
            <br />送信すると、自動で返信が届きます。
          </p>
        )}
        <div className="flex flex-col gap-3">
          {data?.messages.map((m) => (
            <Fragment key={m.id}>
              {unreadFromSeq != null && m.seq === unreadFromSeq && (
                <div ref={(el) => { dividerRef.current = el; }}>
                  <NewMessageDivider />
                </div>
              )}
              {m.speaker === "user" ? (
              <div className="flex flex-col items-end">
                <div className="max-w-[82%] rounded-3xl rounded-br-md px-4 py-2.5 text-base whitespace-pre-wrap text-white" style={{ background: "var(--accent)" }}>
                  {m.body}
                </div>
                <span className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>{formatClock(m.created_at)}</span>
                {m.id === cancelTargetId && (
                  <button
                    type="button"
                    onClick={() => cancelSend.mutate()}
                    disabled={cancelSend.isPending}
                    aria-label="この送信を取り消す"
                    className="mt-1 rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50"
                    style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--border)" }}
                  >
                    送信を取り消す
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Avatar imageUrl={data.character.image_url} name={data.character.display_name} themeColor={data.character.theme_color} size={32} />
                <div className="flex max-w-[82%] flex-col">
                  {reviewMode ? (
                    <button
                      type="button"
                      onClick={() => { setSelectedReviewId(m.id); setReviewError(""); setReviewNotice(""); }}
                      aria-pressed={selectedReviewId === m.id}
                      aria-label={`この発言をレビュー対象に選ぶ: ${m.body.slice(0, 40)}`}
                      className="rounded-3xl rounded-bl-md px-4 py-2.5 text-left text-base whitespace-pre-wrap"
                      style={{
                        background: selectedReviewId === m.id ? "var(--accent-soft)" : "var(--surface)",
                        color: "var(--text)",
                        outline: selectedReviewId === m.id ? "2px solid var(--accent)" : "1.5px dashed var(--border)",
                        outlineOffset: 2,
                      }}
                    >
                      {m.body}
                    </button>
                  ) : (
                    <div className="rounded-3xl rounded-bl-md px-4 py-2.5 text-base whitespace-pre-wrap" style={{ background: "var(--surface)", color: "var(--text)" }}>
                      {m.body}
                    </div>
                  )}
                  <span className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>{formatClock(m.created_at)}</span>
                </div>
              </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-safe" style={{ background: "var(--bg)" }}>
        {reviewNotice && (
          <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "var(--accent-soft)" }} role="status">
            <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text)" }}>{reviewNotice}</p>
            <button type="button" onClick={() => setReviewNotice("")} aria-label="通知を閉じる" className="shrink-0 text-sm font-bold" style={{ color: "var(--dim)" }}>×</button>
          </div>
        )}
        {reviewMode && selectedReviewMsg && data && (
          <ReviewPanel
            speakerName={data.character.display_name}
            messageBody={selectedReviewMsg.body}
            busy={submitReview.isPending}
            error={reviewError}
            onSubmit={(feedback) => submitReview.mutate({ message_id: selectedReviewMsg.id, feedback })}
            onCancel={() => { setSelectedReviewId(null); setReviewError(""); }}
            onOpenHistory={() => setShowReviewHistory(true)}
          />
        )}
        {failNotice && (
          <p className="mb-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--danger)" }} role="alert">
            {failNotice}
          </p>
        )}
        {cancelNotice && (
          <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "var(--accent-soft)" }} role="status">
            <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text)" }}>{cancelNotice}</p>
            <button type="button" onClick={() => setCancelNotice("")} aria-label="通知を閉じる" className="shrink-0 text-sm font-bold" style={{ color: "var(--dim)" }}>×</button>
          </div>
        )}
        <div className="flex items-end gap-2 pb-2">
          <label className="sr-only" htmlFor="chat-input">メッセージ</label>
          <textarea
            id="chat-input"
            {...FIELDS.postMessage.body}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // PC では Enter で送信、Shift+Enter で改行。スマホでは Enter は
              // 改行（既定動作）にし、送信は送信ボタンで行う。日本語入力の
              // 変換確定 Enter では送信しない。
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchPrimary()) {
                e.preventDefault();
                submitDraft();
              }
            }}
            rows={2}
            placeholder={waiting ? "返信待ちです（返信が来るまで送信できません）" : "メッセージを書く"}
            className="min-w-0 flex-1 rounded-3xl px-4 py-2.5 text-base"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
          />
          <button
            type="button"
            disabled={post.isPending || waiting}
            onClick={submitDraft}
            className="shrink-0 rounded-full px-5 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            送信
          </button>
        </div>
        {sendError && <p className="pb-2 text-sm" style={{ color: "var(--danger)" }}>{sendError}</p>}
      </div>

      {showImageEdit && data && (
        <ImageEditSheet
          characterId={characterId}
          characterName={data.character.display_name}
          currentImageUrl={data.character.image_url}
          onClose={() => setShowImageEdit(false)}
        />
      )}

      {showExport && data && (
        <ExportSheet
          title={`${data.character.display_name}とのチャット全文`}
          queryKey={["export-chat", String(characterId)]}
          fetchText={() => api.exportChatText({ character_id: characterId })}
          onClose={() => setShowExport(false)}
        />
      )}

      {showReviewHistory && data && (
        <ReviewHistorySheet
          characterId={characterId}
          characterName={data.character.display_name}
          onClose={() => setShowReviewHistory(false)}
        />
      )}

      {confirmClear && (
        <ConfirmSheet
          title="履歴をクリアしますか？"
          body="このキャラクターとの会話ログが全て消えます。元には戻せません。"
          confirmLabel="クリアする"
          busy={clear.isPending}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => clear.mutate()}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ group chat

/** なりきり設定シート（v1.19 / v1.20 / v1.30）: なりきるキャラの選択（未選択で解除）と、「なりきりキャラの台詞」の扱い（AIも演じる / 自分だけが演じる）を選ぶ。どちらを選んでも、発言したらAIは返信する。台詞の既定値は、なりきり未設定のグループでは「AIも演じる」。すでに保存済みのグループは保存値をそのまま初期値にし、「自分だけが演じる」を選んで保存した選択は変えない。 */
function RoleplaySheet({
  groupId,
  members,
  currentCharacterId,
  currentContinue,
  onClose,
}: {
  groupId: number;
  members: GroupState["members"];
  currentCharacterId: number | null;
  currentContinue: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(currentCharacterId);
  // 既定値（v1.30）: なりきり未設定（currentCharacterId が null）のグループで
  // キャラを新たに選ぶ時は「AIも演じる」を既定にする。保存済みのグループは
  // 保存値 currentContinue をそのまま初期値にし、既存の選択を勝手に変えない。
  const [cont, setCont] = useState<boolean>(currentCharacterId == null ? true : currentContinue);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => await api.setGroupRoleplay({ group_id: groupId, character_id: selected, continue_mode: cont }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  // なりきりに選べるのは、キャラ本体が存在し、現在も参加しているキャラだけ
  // （元参加者は過去の発言の参照用に members へ含まれているだけ）。
  const presentMembers = members.filter((m) => m.present && m.in_group);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="なりきり設定">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>なりきり設定</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          自分がなりきるキャラクターを選ぶと、あなたの送信がそのキャラのアイコンと名前の付いた吹き出しになります（自分が書いた物だと分かるよう、色は通常の送信と同じ色になります）。
        </p>
        <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>なりきるキャラクター</p>
        <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="なりきるキャラクター">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: selected === null ? "var(--accent-soft)" : "transparent" }}>
            <input
              type="radio"
              name="roleplay-character"
              checked={selected === null}
              onChange={() => setSelected(null)}
              aria-label="なりきらない"
              className="h-5 w-5 shrink-0"
            />
            <span className="font-bold" style={{ color: "var(--text)" }}>なりきらない（未選択）</span>
          </label>
          {presentMembers.map((m) => (
            <label key={m.character_id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: selected === m.character_id ? "var(--accent-soft)" : "transparent" }}>
              <input
                type="radio"
                name="roleplay-character"
                checked={selected === m.character_id}
                onChange={() => setSelected(m.character_id)}
                aria-label={`${m.display_name}になりきる`}
                className="h-5 w-5 shrink-0"
              />
              <Avatar imageUrl={m.image_url} name={m.display_name} themeColor={m.theme_color} size={36} />
              <span className="font-bold" style={{ color: "var(--text)" }}>{m.display_name}</span>
            </label>
          ))}
        </div>
        {selected !== null && (
          <>
            <p className="mt-4 text-sm font-bold" style={{ color: "var(--text)" }}>なりきりキャラの台詞</p>
            <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="なりきりキャラの台詞">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-2 py-2" style={{ background: cont ? "var(--accent-soft)" : "transparent" }}>
                <input
                  type="radio"
                  name="roleplay-continue"
                  checked={cont}
                  onChange={() => setCont(true)}
                  aria-label="AIも演じる"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>
                  <span className="block font-bold" style={{ color: "var(--text)" }}>AIも演じる</span>
                  <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>AIが返信し、その後のなりきりキャラの台詞もAIが考えて続けます。なりきりキャラは、あなたとAIの共同になります。</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-2 py-2" style={{ background: !cont ? "var(--accent-soft)" : "transparent" }}>
                <input
                  type="radio"
                  name="roleplay-continue"
                  checked={!cont}
                  onChange={() => setCont(false)}
                  aria-label="自分だけが演じる"
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span>
                  <span className="block font-bold" style={{ color: "var(--text)" }}>自分だけが演じる</span>
                  <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>AIは他のキャラだけで返信して続けます。なりきりキャラの台詞はAIは書きません。そのキャラが話すのは、あなたが打った時だけです。</span>
                </span>
              </label>
            </div>
          </>
        )}
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : "設定する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** グループ設定メニュー（グループ画面の「設定」ボタンから開く）。項目は「名前を変える」「参加者を変える」「ゲスト・モブ・ナレーションの設定」「背景情報を編集する」の4つ。 */
function GroupMenuSheet({
  groupName,
  onClose,
  onRename,
  onEditMembers,
  onGuestMob,
  onBackground,
}: {
  groupName: string;
  onClose: () => void;
  onRename: () => void;
  onEditMembers: () => void;
  onGuestMob: () => void;
  onBackground: () => void;
}) {
  const items: { label: string; description: string; onSelect: () => void }[] = [
    { label: "グループチャットの名前を変える", description: "このグループの表示名を変更します（参加者や会話履歴には影響しません）", onSelect: onRename },
    { label: "グループチャットの参加者を変える", description: "参加キャラクターを1〜8人の間で増やしたり減らしたりできます（会話履歴は残ります）", onSelect: onEditMembers },
    { label: "ゲスト・モブ・ナレーションの設定", description: "参加者以外のキャラクター（ゲスト）や名前のない人々（モブ）が会話に混じることがあるかと、背景説明・場面転換のナレーションを入れるかを選びます", onSelect: onGuestMob },
    { label: "背景情報を編集する", description: "このグループの生成（通常・自動の両方）に常に添える背景情報（場所や状況など）を書きます。一度書けば使われ続けます", onSelect: onBackground },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="グループ設定メニュー">
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display min-w-0 truncate text-lg font-bold" style={{ color: "var(--text)" }}>{groupName}の設定</h2>
        <div className="mt-4 flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onSelect}
              className="w-full rounded-2xl px-4 py-3 text-left"
              style={{ background: "var(--surface-alt)", color: "var(--text)" }}
            >
              <span className="block font-bold">{item.label}</span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--dim)" }}>{item.description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full px-4 py-2.5 font-bold"
          style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

/** ゲスト・モブ・ナレーションの設定シート（グループ設定メニューの「ゲスト・モブ・ナレーションの設定」から開く）。
 *  オンにすると、生成の場面に応じて参加者以外のキャラ（ゲスト）や名前のない人々
 *  （モブ）が会話に混じることがある。混じらないこともある。ナレーションは、会話の
 *  背景説明・場面転換・時間経過の説明が、誰の台詞でもない形で入ることがある。 */
function GroupGuestMobSheet({
  groupId,
  currentGuests,
  currentMobs,
  currentNarration,
  onClose,
}: {
  groupId: number;
  currentGuests: boolean;
  currentMobs: boolean;
  currentNarration: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [guests, setGuests] = useState(currentGuests);
  const [mobs, setMobs] = useState(currentMobs);
  const [narration, setNarration] = useState(currentNarration);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => await api.setGroupGuestMob({ group_id: groupId, allow_guests: guests, allow_mobs: mobs, allow_narration: narration }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="ゲスト・モブ・ナレーションの設定">
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>ゲスト・モブ・ナレーションの設定</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          オンにすると、会話の流れに応じて参加者以外のキャラクターや人々が混じることがあります（混じらないこともあります）。参加者や会話履歴には影響しません。
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-3" style={{ background: guests ? "var(--accent-soft)" : "var(--surface-alt)" }}>
            <input
              type="checkbox"
              checked={guests}
              onChange={(e) => setGuests(e.target.checked)}
              aria-label="ゲストを許可する"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block font-bold" style={{ color: "var(--text)" }}>ゲスト</span>
              <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                このグループに参加していないキャラクターが、そのキャラクターの名前で会話に入ることがあります。このアプリに登録済みのキャラクターが登場する場合は、その設定を参考にします。登録されていないキャラクターのアイコンはデフォルト表示になります。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-3" style={{ background: mobs ? "var(--accent-soft)" : "var(--surface-alt)" }}>
            <input
              type="checkbox"
              checked={mobs}
              onChange={(e) => setMobs(e.target.checked)}
              aria-label="モブを許可する"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block font-bold" style={{ color: "var(--text)" }}>モブ</span>
              <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                名前のない一般の人々が、「住民」「生徒」「兵士」のような一般名詞の表記で会話に入ることがあります。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-3" style={{ background: narration ? "var(--accent-soft)" : "var(--surface-alt)" }}>
            <input
              type="checkbox"
              checked={narration}
              onChange={(e) => setNarration(e.target.checked)}
              aria-label="ナレーションを許可する"
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block font-bold" style={{ color: "var(--text)" }}>ナレーション</span>
              <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                会話の背景説明・場面転換・時間経過の説明が、誰の台詞でもないナレーションとして入ることがあります（例:「〇〇達は××に訪れていた」「◯時間後」）。吹き出しではなく、中央揃えの控えめな表示になります。場面の立ち上げや転換の時だけ、控えめに入ります。
              </span>
            </span>
          </label>
        </div>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 背景情報の編集シート（設計書 v2.0 / C）。グループの生成（通常・自動の両方）のシステムプロンプトへ常時含まれる。 */
function GroupBackgroundSheet({
  groupId,
  currentText,
  onClose,
}: {
  groupId: number;
  currentText: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(currentText);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => await api.updateGroupBackground({ group_id: groupId, background_text: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="背景情報を編集する">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>背景情報を編集する</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          このグループの会話の前提になる情報（場所・状況・関係性など）を書きます。ここに書いた内容は、このグループの生成（通常の投稿への返信・スケジューリングの自動生成の両方）に毎回添えられます。一度書けば使われ続け、空にすると添えられなくなります。自動生成を使わないグループでも設定できます。
        </p>
        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="group-background-text">
          背景情報
        </label>
        <textarea
          id="group-background-text"
          {...FIELDS.updateGroupBackground.background_text}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="例: 放課後の教室で、文化祭の準備をしている。3人は同じクラスの同級生。"
          className="mt-1 w-full rounded-2xl px-3 py-2.5 text-sm"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** グループ名の変更シート。参加者・会話履歴には影響しない。 */
function RenameGroupSheet({ groupId, currentName, onClose }: { groupId: number; currentName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");
  const rename = useMutation({
    mutationFn: async (n: string) => await api.renameGroup({ group_id: groupId, name: n }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "変更に失敗しました"),
  });
  const submit = () => {
    const v = name.trim();
    if (!v) {
      setError("グループ名を入力してください。");
      return;
    }
    if (v === currentName) {
      onClose();
      return;
    }
    setError("");
    rename.mutate(v);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="グループチャットの名前を変える">
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>グループチャットの名前を変える</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          一覧やグループ画面で表示される名前を変えます。参加者や会話履歴には影響しません。
        </p>
        <label className="mt-4 block text-sm font-bold" style={{ color: "var(--text)" }} htmlFor="rename-group-name">
          グループ名
        </label>
        <input
          id="rename-group-name"
          {...FIELDS.renameGroup.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl px-3 py-2.5"
          style={{ background: "var(--surface-alt)", color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={rename.isPending}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {rename.isPending ? "保存中…" : "変更する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 参加者の変更シート。1〜8人の間で増減できる（1人だけでも保存できる）。なりきり中のキャラを外すと、なりきりは解除される（サーバ側でも未選択に戻す）。 */
function GroupMembersSheet({
  groupId,
  currentMemberIds,
  roleplayMember,
  onClose,
}: {
  groupId: number;
  currentMemberIds: number[];
  roleplayMember: { character_id: number; display_name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const home = useQuery({ queryKey: ["home"], queryFn: () => api.listHome({}) });
  const [selected, setSelected] = useState<number[]>(currentMemberIds);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = useMutation({
    mutationFn: async () => await api.updateGroupMembers({ group_id: groupId, character_ids: selected }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      if (r.roleplay_cleared) {
        setNotice("参加者を変更しました。なりきり中のキャラクターが外れたため、なりきりは解除されました。");
        // 解除されたことが分かるよう、通知を見せてから閉じられるようにする。
        setTimeout(onClose, 1200);
      } else {
        onClose();
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : "変更に失敗しました"),
  });
  const toggle = (id: number) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 8) { setError("グループは最大8人までです。"); return prev; }
      setError("");
      return [...prev, id];
    });
  };
  const characters: CharacterItem[] = home.data?.characters ?? [];
  const categories: CategoryItem[] = home.data?.categories ?? [];
  // シート内のカテゴリ絞り込み（v1.24、階層対応 v1.26）: グループ作成シートと機能を合わせる。
  // "all" = 未指定（全員）/ "none" = 未分類のみ / 数値 = そのカテゴリ（子孫カテゴリを含む）。
  // 並びは一覧側の設定に関わらず常に五十音順。絞り込みで隠れたキャラの選択は保持する。
  const [catFilter, setCatFilter] = useState<"all" | "none" | number>("all");
  const visibleCharacters = sortCharactersBy(
    characters.filter((c) => {
      if (catFilter === "all") return true;
      if (catFilter === "none") return charCategoryIds(c).length === 0;
      return charMatchesCategory(c, categories, catFilter);
    }),
    "gojuon",
  );
  const roleplayRemoved = roleplayMember != null && !selected.includes(roleplayMember.character_id);
  const submit = () => {
    if (selected.length < 1) { setError("参加者は1人以上選んでください。"); return; }
    if (selected.length > 8) { setError("参加者は8人までです。"); return; }
    setError("");
    save.mutate();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(10,6,20,0.55)" }} role="dialog" aria-modal="true" aria-label="グループチャットの参加者を変える">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-safe" style={{ background: "var(--surface)" }}>
        <h2 className="font-display text-lg font-bold" style={{ color: "var(--text)" }}>グループチャットの参加者を変える</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          参加キャラクターは1〜8人です。外したキャラクターは会話に参加しなくなりますが、過去の発言は名前と画像つきで会話履歴にそのまま残ります。
        </p>
        <p className="mt-3 text-sm font-bold" style={{ color: "var(--text)" }}>参加キャラクター（現在 {selected.length}人）</p>
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold" style={{ color: "var(--dim)" }} htmlFor="group-members-category-filter">カテゴリ</label>
            <select
              id="group-members-category-filter"
              value={catFilter === "all" ? "all" : catFilter === "none" ? "none" : String(catFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setCatFilter(v === "all" ? "all" : v === "none" ? "none" : Number(v));
              }}
              className="rounded-full px-3 py-1.5 text-sm font-bold"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              <option value="all">すべて</option>
              {categoryTreeEntries(categories).map(({ cat, depth }) => (
                <option key={cat.id} value={String(cat.id)}>{categoryOptionLabel(cat, depth)}</option>
              ))}
              <option value="none">未分類</option>
            </select>
            <span className="text-xs" style={{ color: "var(--dim)" }}>選択中 {selected.length}人</span>
          </div>
        )}
        {home.isPending && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {home.error && (
          <div className="mt-2">
            <p className="text-sm" style={{ color: "var(--danger)" }}>キャラクター一覧の読み込みに失敗しました。</p>
            <button type="button" onClick={() => home.refetch()} className="mt-2 rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
              再読み込み
            </button>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-1">
          {visibleCharacters.map((c) => (
            <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5" style={{ background: selected.includes(c.id) ? "var(--accent-soft)" : "transparent" }}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                aria-label={`${c.display_name}を参加させる`}
                className="h-5 w-5 shrink-0"
              />
              <Avatar imageUrl={c.image_url} name={c.display_name} themeColor={c.theme_color} size={36} />
              <span className="font-bold" style={{ color: "var(--text)" }}>{c.display_name}</span>
              {currentMemberIds.includes(c.id) && (
                <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--surface-alt)", color: "var(--dim)" }}>参加中</span>
              )}
            </label>
          ))}
          {visibleCharacters.length === 0 && !home.isPending && (
            <p className="px-2 py-3 text-sm" style={{ color: "var(--dim)" }}>このカテゴリのキャラクターはいません。</p>
          )}
        </div>
        {roleplayRemoved && roleplayMember && (
          <p className="mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--danger)" }} role="alert">
            なりきり中の「{roleplayMember.display_name}」を外すと、なりきりは解除され未選択に戻ります。
          </p>
        )}
        {notice && (
          <p className="mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--text)" }} role="status">
            {notice}
          </p>
        )}
        {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-full px-4 py-2.5 font-bold" style={{ background: "var(--surface-alt)", color: "var(--text)" }}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={save.isPending || selected.length < 1}
            className="flex-1 rounded-full px-4 py-2.5 font-bold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {save.isPending ? "保存中…" : "変更する"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupView({ groupId, unreadFromSeq, back }: { groupId: number; unreadFromSeq: number | null; back: () => void }) {
  const queryClient = useQueryClient();
  useLockBodyScroll();
  const state = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.getGroupState({ group_id: groupId }),
    refetchInterval: 10000,
  });
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [failNotice, setFailNotice] = useState("");
  const [cancelNotice, setCancelNotice] = useState("");
  const [confirm, setConfirm] = useState<"clear" | "delete" | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showRoleplay, setShowRoleplay] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showRenameGroup, setShowRenameGroup] = useState(false);
  const [showEditMembers, setShowEditMembers] = useState(false);
  const [showGuestMob, setShowGuestMob] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [historyChar, setHistoryChar] = useState<{ id: number; name: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const prevMsgCountRef = useRef(0);
  const msgCount = state.data?.messages.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !state.data) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      prevMsgCountRef.current = msgCount;
      // 「新着」区切りがある時は、開いた直後に区切りの位置が見えるようにする。
      if (unreadFromSeq != null && dividerRef.current) {
        // scrollIntoView は文書を含む全ての祖先スクロールを動かし画面全体が
        // ずれるため、このスクロール領域の中だけで区切りが中央に来るよう計算する。
        const target = dividerRef.current;
        const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += delta - (el.clientHeight - target.clientHeight) / 2;
        return;
      }
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (msgCount !== prevMsgCountRef.current) {
      prevMsgCountRef.current = msgCount;
      el.scrollTop = el.scrollHeight;
    }
  }, [msgCount, state.data, unreadFromSeq]);
  useDraftRestore(state.data?.draft, setDraft, setFailNotice);

  // 1対1と同様、開いている間に見えた発言まで既読を明示する。
  const latestGroupSeq = state.data?.messages[state.data.messages.length - 1]?.seq ?? 0;
  const markGroupRead = useMutation({ mutationFn: async () => await api.markGroupRead({ group_id: groupId }) });
  const markedGroupSeqRef = useRef(0);
  const markGroupReadMutate = markGroupRead.mutate;
  useEffect(() => {
    if (latestGroupSeq > markedGroupSeqRef.current) {
      markedGroupSeqRef.current = latestGroupSeq;
      markGroupReadMutate();
    }
  }, [latestGroupSeq, markGroupReadMutate]);

  const post = useMutation({
    mutationFn: async (body: string) => await api.postGroupPrompt({ group_id: groupId, body }),
    onSuccess: () => {
      setDraft("");
      setSendError("");
      setFailNotice("");
      setCancelNotice("");
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "送信に失敗しました"),
  });
  const cancelSend = useMutation({
    mutationFn: async () => await api.cancelPendingSend({ target_kind: "group", target_id: groupId }),
    onSuccess: (res) => {
      if (res.cancelled) {
        // 取り消した文章を入力欄へ戻す。入力途中の文章があれば、その前に連結する。
        setDraft((prev) => (prev.trim() ? `${res.restored_text}\n${prev}` : res.restored_text));
        setFailNotice("");
        setSendError("");
        setCancelNotice("送信を取り消しました。文章を入力欄に戻しました。");
      } else {
        setCancelNotice("生成が始まっているため、取り消せませんでした。");
      }
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "取り消しに失敗しました"),
  });
  const clear = useMutation({
    mutationFn: async () => await api.clearGroupHistory({ group_id: groupId }),
    onSuccess: () => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
    },
  });
  const del = useMutation({
    mutationFn: async () => await api.deleteGroup({ group_id: groupId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home"] });
      back();
    },
  });
  const submitReview = useMutation({
    mutationFn: async (args: { message_id: number; feedback: string }) =>
      await api.submitReview({ target_kind: "group", target_id: groupId, message_id: args.message_id, feedback: args.feedback }),
    onSuccess: () => {
      setSelectedReviewId(null);
      setReviewError("");
      setReviewNotice("レビューを登録しました。見直しが終わると設定へ自動で反映されます。結果はレビュー履歴で確認できます。");
      queryClient.invalidateQueries({ queryKey: ["reviewHistory"] });
    },
    onError: (e) => setReviewError(e instanceof Error ? e.message : "レビューの送信に失敗しました"),
  });

  const data: GroupState | undefined = state.data;
  const req = data?.request;

  // 返信待ち（pending / 生成中）の間は投稿できない。取り消しボタンは
  // 生成が始まる前（pending の間）だけ出す。対象は、未返信の話題がある時は
  // その最後の話題、なりきり発言への返信待ちの時は最後のなりきり発言。
  const waiting = req?.status === "pending" || req?.status === "processing";
  // 自動生成（auto）の開始待ちは送信取り消しの対象外（設計書 v2.0 / B）。
  const canCancel = req?.status === "pending" && req.origin !== "auto";
  const groupUserMsgs = (data?.messages ?? []).filter((m) => m.kind === "user");
  const unrepliedMsgs = canCancel && req.unreplied_count > 0 ? groupUserMsgs.slice(-req.unreplied_count) : [];
  const roleplayMsgs = (data?.messages ?? []).filter((m) => m.user_authored);
  const cancelTargetId =
    unrepliedMsgs.length
      ? unrepliedMsgs[unrepliedMsgs.length - 1]!.id
      : canCancel && roleplayMsgs.length
        ? roleplayMsgs[roleplayMsgs.length - 1]!.id
        : null;

  // 投稿ボタンと Enter キーで共用する投稿処理。
  const submitDraft = () => {
    if (post.isPending) return;
    if (waiting) { setSendError("掛け合いが来るまで投稿できません。"); return; }
    if (!draft.trim()) { setSendError(data?.roleplay_character_id != null ? "発言を入力してください。" : "話題や指示を入力してください。"); return; }
    post.mutate(draft.trim());
  };
  const dissolved = data?.group.status === "dissolved";
  const memberById = new Map((data?.members ?? []).map((m) => [m.character_id, m]));
  // なりきり中のキャラ（未設定・削除済みの場合は null）。
  const roleplayMember =
    data && data.roleplay_character_id != null ? memberById.get(data.roleplay_character_id) ?? null : null;
  const selectedReviewMsg = data?.messages.find((m) => m.id === selectedReviewId && m.kind === "character") ?? null;

  return (
    <div
      className="fixed top-0 right-0 left-0 mx-auto flex w-full max-w-2xl flex-col"
      style={{ height: "100dvh", background: "var(--bg)" }}
    >
      <header className="shrink-0 px-3 pt-safe pb-2" style={{ background: "var(--bg)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={back} aria-label="一覧へ戻る" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: "var(--surface)", color: "var(--text)" }}>
            ←
          </button>
          <h2 className="font-display min-w-24 flex-1 truncate text-lg font-black" style={{ color: "var(--text)" }}>{data?.group.name ?? "グループ"}</h2>
          {data && data.group.status === "active" && (
            <button
              type="button"
              onClick={() => setShowGroupMenu(true)}
              aria-label="グループ設定"
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
              style={{ background: "var(--surface)", color: "var(--dim)" }}
            >
              <GearIcon />
              設定
            </button>
          )}
          <button type="button" onClick={() => setConfirm("clear")} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--dim)" }}>
            履歴クリア
          </button>
          <button type="button" onClick={() => setConfirm("delete")} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--danger)" }}>
            グループ削除
          </button>
          <button type="button" onClick={() => setShowExport(true)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: "var(--surface)", color: "var(--dim)" }}>
            全文出力
          </button>
          {data && data.group.status === "active" && (
            <button
              type="button"
              onClick={() => setShowRoleplay(true)}
              aria-pressed={data.roleplay_character_id != null}
              className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={
                data.roleplay_character_id != null
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "var(--surface)", color: "var(--dim)" }
              }
            >
              なりきり
            </button>
          )}
          <ReviewModeToggle
            active={reviewMode}
            onToggle={() => {
              setReviewMode((v) => !v);
              setSelectedReviewId(null);
              setReviewError("");
            }}
          />
        </div>
        {data && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* 参加者一覧には現在の参加者だけを出す（v1.24）。元参加者は
                members に過去発言の名前・画像の参照用として含まれているだけで、
                ここには表示しない。 */}
            {data.members.filter((m) => m.in_group).map((m) => (
              <span key={m.character_id} className="flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-bold" style={{ background: "var(--surface)", color: m.present ? "var(--text)" : "var(--dim)" }}>
                <Avatar imageUrl={m.image_url} name={m.display_name} themeColor={m.theme_color} size={22} />
                {m.display_name}{!m.present ? "（削除済み）" : ""}
              </span>
            ))}
            {roleplayMember && (
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white" style={{ background: "var(--accent)" }}>
                なりきり中: {roleplayMember.display_name}（{data.roleplay_continue ? "AIも演じる" : "自分だけが演じる"}）
              </span>
            )}
          </div>
        )}
        {dissolved && (
          <p className="mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--dim)" }}>
            このグループは解散済みです（参加キャラクターが2人未満になりました）。ログの閲覧のみできます。
          </p>
        )}
      </header>

      {reviewMode && data && (
        <div className="mx-3 mt-1 rounded-xl px-3 py-2" style={{ background: "var(--surface)" }} role="status">
          <p className="text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
            レビューモード中です。キャラの発言をタップして選ぶと、そのキャラの設定への指摘ができます。
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.members.filter((m) => m.present).map((m) => (
              <button
                key={m.character_id}
                type="button"
                onClick={() => setHistoryChar({ id: m.character_id, name: m.display_name })}
                className="rounded-full px-2.5 py-1 text-xs font-bold"
                style={{ background: "var(--surface-alt)", color: "var(--text)" }}
              >
                {m.display_name}のレビュー履歴
              </button>
            ))}
          </div>
        </div>
      )}

      {req && <RequestBanner request={req} isGroup />}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-none px-3 py-3">
        {state.isPending && <p className="py-8 text-center text-sm" style={{ color: "var(--dim)" }}>読み込み中…</p>}
        {state.error && <p className="py-8 text-center text-sm" style={{ color: "var(--danger)" }}>読み込みに失敗しました。</p>}
        {data && data.messages.length === 0 && (
          <p className="py-8 text-center text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
            まだ掛け合いがありません。下の入力欄に話題や指示を書いて投稿すると、自動で掛け合いが始まります。
          </p>
        )}
        <div className="flex flex-col gap-3">
          {data?.messages.map((m) => {
            const divider = unreadFromSeq != null && m.seq === unreadFromSeq ? (
              <div ref={(el) => { dividerRef.current = el; }}>
                <NewMessageDivider />
              </div>
            ) : null;
            if (m.kind === "user") {
              return (
                <Fragment key={m.id}>
                  {divider}
                  <div className="flex flex-col items-end">
                    <div className="max-w-[82%] rounded-3xl rounded-br-md px-4 py-2.5 text-base whitespace-pre-wrap text-white" style={{ background: "var(--accent)" }}>
                      {m.body}
                    </div>
                    <span className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>話題 {formatClock(m.created_at)}</span>
                    {m.id === cancelTargetId && (
                      <button
                        type="button"
                        onClick={() => cancelSend.mutate()}
                        disabled={cancelSend.isPending}
                        aria-label="この送信を取り消す"
                        className="mt-1 rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50"
                        style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--border)" }}
                      >
                        送信を取り消す
                      </button>
                    )}
                  </div>
                </Fragment>
              );
            }
            if (m.kind === "narration") {
              // ナレーション（v3.1）: 吹き出しにせず、アバター・名前なしで
              // 中央揃えのシステムメッセージ的に表示する。
              return (
                <Fragment key={m.id}>
                  {divider}
                  <div className="flex justify-center px-2 py-1">
                    <p className="max-w-[88%] text-center text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--dim)" }}>
                      {m.body}
                    </p>
                  </div>
                </Fragment>
              );
            }
            if (m.kind === "raw") {
              return (
                <Fragment key={m.id}>
                  {divider}
                  <div className="rounded-2xl px-4 py-3" style={{ border: "1.5px dashed var(--danger)", background: "var(--surface)" }}>
                    <p className="text-xs font-bold" style={{ color: "var(--danger)" }}>分割できなかった出力</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{m.body}</p>
                  </div>
                </Fragment>
              );
            }
            const member = m.character_id != null ? memberById.get(m.character_id) : undefined;
            // なりきり発言は、キャラのアイコンと名前の吹き出しにしつつ、
            // 利用者本人が書いた物だと分かるよう通常の送信と同じ色にする。
            // 自分で書いた発言はレビュー対象にしない。
            const isRoleplayLine = m.user_authored;
            return (
              <Fragment key={m.id}>
                {divider}
                <div className="flex items-start gap-2">
                <Avatar imageUrl={member?.image_url ?? null} name={m.speaker_name} themeColor={member?.theme_color ?? ""} size={32} />
                <div className="flex max-w-[82%] flex-col">
                  <span className="font-display mb-0.5 text-xs font-bold" style={{ color: "var(--dim)" }}>{m.speaker_name}</span>
                  {reviewMode && m.character_id != null && !isRoleplayLine ? (
                    <button
                      type="button"
                      onClick={() => { setSelectedReviewId(m.id); setReviewError(""); setReviewNotice(""); }}
                      aria-pressed={selectedReviewId === m.id}
                      aria-label={`この発言をレビュー対象に選ぶ: ${m.body.slice(0, 40)}`}
                      className="rounded-3xl rounded-bl-md px-4 py-2.5 text-left text-base whitespace-pre-wrap"
                      style={{
                        background: selectedReviewId === m.id ? "var(--accent-soft)" : "var(--surface)",
                        color: "var(--text)",
                        outline: selectedReviewId === m.id ? "2px solid var(--accent)" : "1.5px dashed var(--border)",
                        outlineOffset: 2,
                      }}
                    >
                      {m.body}
                    </button>
                  ) : isRoleplayLine ? (
                    <div className="rounded-3xl rounded-bl-md px-4 py-2.5 text-base whitespace-pre-wrap text-white" style={{ background: "var(--accent)" }}>
                      {m.body}
                    </div>
                  ) : (
                    <div className="rounded-3xl rounded-bl-md px-4 py-2.5 text-base whitespace-pre-wrap" style={{ background: "var(--surface)", color: "var(--text)" }}>
                      {m.body}
                    </div>
                  )}
                  <span className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>{formatClock(m.created_at)}</span>
                  {m.id === cancelTargetId && (
                    <button
                      type="button"
                      onClick={() => cancelSend.mutate()}
                      disabled={cancelSend.isPending}
                      aria-label="この送信を取り消す"
                      className="mt-1 self-start rounded-full px-3 py-1 text-xs font-bold disabled:opacity-50"
                      style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid var(--border)" }}
                    >
                      送信を取り消す
                    </button>
                  )}
                </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {!dissolved && (
        <div className="shrink-0 px-3 pb-safe" style={{ background: "var(--bg)" }}>
          {reviewNotice && (
            <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "var(--accent-soft)" }} role="status">
              <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text)" }}>{reviewNotice}</p>
              <button type="button" onClick={() => setReviewNotice("")} aria-label="通知を閉じる" className="shrink-0 text-sm font-bold" style={{ color: "var(--dim)" }}>×</button>
            </div>
          )}
          {reviewMode && selectedReviewMsg && selectedReviewMsg.character_id != null && (
            <ReviewPanel
              speakerName={selectedReviewMsg.speaker_name}
              messageBody={selectedReviewMsg.body}
              busy={submitReview.isPending}
              error={reviewError}
              onSubmit={(feedback) => submitReview.mutate({ message_id: selectedReviewMsg.id, feedback })}
              onCancel={() => { setSelectedReviewId(null); setReviewError(""); }}
              onOpenHistory={() => setHistoryChar({ id: selectedReviewMsg.character_id!, name: selectedReviewMsg.speaker_name })}
            />
          )}
          {failNotice && (
            <p className="mb-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--accent-soft)", color: "var(--danger)" }} role="alert">
              {failNotice}
            </p>
          )}
          {cancelNotice && (
            <div className="mb-2 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "var(--accent-soft)" }} role="status">
              <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--text)" }}>{cancelNotice}</p>
              <button type="button" onClick={() => setCancelNotice("")} aria-label="通知を閉じる" className="shrink-0 text-sm font-bold" style={{ color: "var(--dim)" }}>×</button>
            </div>
          )}
          <div className="flex items-end gap-2 pb-2">
            <label className="sr-only" htmlFor="group-input">話題・指示</label>
            <textarea
              id="group-input"
              {...FIELDS.postGroupPrompt.body}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // PC では Enter で投稿、Shift+Enter で改行。スマホでは Enter は
                // 改行（既定動作）にし、投稿は投稿ボタンで行う。日本語入力の
                // 変換確定 Enter では投稿しない。
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchPrimary()) {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              rows={2}
              placeholder={
                waiting
                  ? "掛け合い待ちです（届くまで投稿できません）"
                  : roleplayMember
                    ? `${roleplayMember.display_name}として発言する`
                    : "話題や指示を書く（例: 初めて会った時の話をして）"
              }
              className="min-w-0 flex-1 rounded-3xl px-4 py-2.5 text-base"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              disabled={post.isPending || waiting}
              onClick={submitDraft}
              className="shrink-0 rounded-full px-5 py-2.5 font-bold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {roleplayMember ? "発言" : "投稿"}
            </button>
          </div>
          {sendError && <p className="pb-2 text-sm" style={{ color: "var(--danger)" }}>{sendError}</p>}
        </div>
      )}

      {historyChar && (
        <ReviewHistorySheet
          characterId={historyChar.id}
          characterName={historyChar.name}
          onClose={() => setHistoryChar(null)}
        />
      )}

      {showRoleplay && data && (
        <RoleplaySheet
          groupId={groupId}
          members={data.members}
          currentCharacterId={data.roleplay_character_id}
          currentContinue={data.roleplay_continue}
          onClose={() => setShowRoleplay(false)}
        />
      )}

      {showGroupMenu && data && (
        <GroupMenuSheet
          groupName={data.group.name}
          onClose={() => setShowGroupMenu(false)}
          onRename={() => {
            setShowGroupMenu(false);
            setShowRenameGroup(true);
          }}
          onEditMembers={() => {
            setShowGroupMenu(false);
            setShowEditMembers(true);
          }}
          onGuestMob={() => {
            setShowGroupMenu(false);
            setShowGuestMob(true);
          }}
          onBackground={() => {
            setShowGroupMenu(false);
            setShowBackground(true);
          }}
        />
      )}

      {showBackground && data && (
        <GroupBackgroundSheet
          groupId={groupId}
          currentText={data.group.background_text}
          onClose={() => setShowBackground(false)}
        />
      )}

      {showGuestMob && data && (
        <GroupGuestMobSheet
          groupId={groupId}
          currentGuests={data.allow_guests}
          currentMobs={data.allow_mobs}
          currentNarration={data.allow_narration}
          onClose={() => setShowGuestMob(false)}
        />
      )}

      {showRenameGroup && data && (
        <RenameGroupSheet
          groupId={groupId}
          currentName={data.group.name}
          onClose={() => setShowRenameGroup(false)}
        />
      )}

      {showEditMembers && data && (
        <GroupMembersSheet
          groupId={groupId}
          currentMemberIds={data.members.filter((m) => m.in_group).map((m) => m.character_id)}
          roleplayMember={roleplayMember ? { character_id: roleplayMember.character_id, display_name: roleplayMember.display_name } : null}
          onClose={() => setShowEditMembers(false)}
        />
      )}

      {showExport && data && (
        <ExportSheet
          title={`グループ「${data.group.name}」の全文`}
          queryKey={["export-group", String(groupId)]}
          fetchText={() => api.exportGroupText({ group_id: groupId })}
          onClose={() => setShowExport(false)}
        />
      )}

      {confirm === "clear" && (
        <ConfirmSheet
          title="履歴をクリアしますか？"
          body="このグループの掛け合いログが全て消えます。元には戻せません。"
          confirmLabel="クリアする"
          busy={clear.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => clear.mutate()}
        />
      )}
      {confirm === "delete" && (
        <ConfirmSheet
          title="グループを削除しますか？"
          body="グループと掛け合いログが全て消えます。元には戻せません。"
          confirmLabel="削除する"
          busy={del.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => del.mutate()}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ app

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: "home" });
  // 一覧へ戻るたびに最新の状態を取り直す（設計書 v1.8 / 4.8章）。
  // 並び替え・未読などの表示が、手動更新なしで常に最新になるようにする。
  const goHome = () => {
    queryClient.invalidateQueries({ queryKey: ["home"] });
    setView({ kind: "home" });
  };
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {view.kind === "home" && (
        <>
          <SafeAreaTopScrim backgroundColor="var(--bg)" />
          <HomeView go={setView} />
        </>
      )}
      {view.kind === "chat" && <ChatView characterId={view.characterId} unreadFromSeq={view.unreadFromSeq} back={goHome} />}
      {view.kind === "group" && <GroupView groupId={view.groupId} unreadFromSeq={view.unreadFromSeq} back={goHome} />}
      {view.kind === "logs" && (
        <>
          <SafeAreaTopScrim backgroundColor="var(--bg)" />
          <LogsView back={goHome} />
        </>
      )}
    </div>
  );
}
