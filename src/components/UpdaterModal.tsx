import type { UpdateInfo, DownloadProgress } from "../lib/updater";

// Updater modal — rendered at App root so it overlays the entire window while
// a new version is available or being installed. The state machine lives in
// `App.tsx`; this is a pure presentation component.
export function UpdaterModal({
  state,
  onInstall,
  onDismiss,
}: {
  state:
    | { kind: "available"; info: UpdateInfo; handle: unknown }
    | { kind: "installing"; info: UpdateInfo; progress: DownloadProgress | null };
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const info = state.info;
  const installing = state.kind === "installing";
  const progress = installing ? state.progress : null;
  const pct = (() => {
    if (!progress) return null;
    if (progress.kind === "finished") return 100;
    if (progress.kind === "progress" && progress.total) {
      return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
    }
    return null;
  })();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 16, 10, 0.36)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={installing ? undefined : onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 340,
          background: "var(--paper)",
          border: "1px solid var(--hairline)",
          borderRadius: 6,
          padding: "16px 18px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          fontFamily: "var(--sans)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {installing ? "正在安装" : "发现新版本"}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          v{info.currentVersion} → <strong style={{ color: "var(--ink)" }}>v{info.version}</strong>
        </div>

        {info.notes && !installing && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "var(--ink-soft)",
              maxHeight: 140,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              padding: 8,
              background: "var(--paper-soft)",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
            }}
          >
            {info.notes}
          </div>
        )}

        {installing && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                height: 6,
                background: "var(--paper-soft)",
                border: "1px solid var(--hairline)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: pct !== null ? `${pct}%` : "30%",
                  background: "var(--ink)",
                  transition: "width 150ms linear",
                  // Indeterminate-ish look when total length unknown
                  opacity: pct !== null ? 1 : 0.5,
                }}
              />
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
              {progress?.kind === "started" && "开始下载…"}
              {progress?.kind === "progress" &&
                (progress.total
                  ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}  (${pct}%)`
                  : `${formatBytes(progress.downloaded)}`)}
              {progress?.kind === "finished" && "安装完成，准备重启…"}
              {progress === null && "准备下载…"}
            </div>
          </div>
        )}

        {!installing && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button
              onClick={onDismiss}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: "var(--sans)",
                background: "transparent",
                border: "1px solid var(--hairline)",
                borderRadius: 4,
                color: "var(--ink-soft)",
                cursor: "pointer",
              }}
            >
              稍后
            </button>
            <button
              onClick={onInstall}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontFamily: "var(--sans)",
                fontWeight: 600,
                background: "var(--ink)",
                border: "1px solid var(--ink)",
                borderRadius: 4,
                color: "var(--paper)",
                cursor: "pointer",
              }}
            >
              立即安装
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
