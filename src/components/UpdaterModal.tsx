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

  const hasRealNotes = Boolean(info.notes && !/^Release v[0-9]/.test(info.notes.trim()));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 16, 10, 0.42)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
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
          maxWidth: 380,
          background: "var(--paper)",
          border: "1px solid var(--hairline)",
          borderRadius: 10,
          padding: "20px 22px 18px",
          boxShadow: "0 18px 40px -12px rgba(40, 26, 12, 0.28), 0 2px 6px rgba(40, 26, 12, 0.06)",
          fontFamily: "var(--sans)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {installing ? "Installing" : "Update available"}
        </div>

        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <VersionChip label={`v${info.currentVersion}`} tone="muted" />
          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>→</span>
          <VersionChip label={`v${info.version}`} tone="strong" />
        </div>

        {!installing && (
          hasRealNotes ? (
            <NotesBlock notes={info.notes!} />
          ) : (
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                color: "var(--muted)",
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              No release notes for this version.
            </div>
          )
        )}

        {installing && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                height: 6,
                background: "var(--paper-soft)",
                border: "1px solid var(--hairline)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: pct !== null ? `${pct}%` : "30%",
                  background: "var(--ink)",
                  transition: "width 150ms linear",
                  opacity: pct !== null ? 1 : 0.5,
                  borderRadius: 999,
                }}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
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
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            <button
              onClick={onDismiss}
              style={btnSecondary}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              稍后
            </button>
            <button
              onClick={onInstall}
              style={btnPrimary}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ink)")}
            >
              立即安装
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionChip({ label, tone }: { label: string; tone: "muted" | "strong" }) {
  const isStrong = tone === "strong";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 9px",
        borderRadius: 999,
        fontFamily: "var(--mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: 12,
        fontWeight: isStrong ? 600 : 500,
        letterSpacing: "0.02em",
        color: isStrong ? "var(--paper)" : "var(--ink-soft)",
        background: isStrong ? "var(--ink)" : "var(--paper-soft)",
        border: `1px solid ${isStrong ? "var(--ink)" : "var(--hairline)"}`,
      }}
    >
      {label}
    </span>
  );
}

// Release notes panel with a left accent stripe + monospace for code-ish lines.
// Scrolls inside its own box; no border so the page feels less boxed-in.
function NotesBlock({ notes }: { notes: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        position: "relative",
        paddingLeft: 12,
        borderLeft: "2px solid var(--hairline)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--ink-soft)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 200,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {notes.trim()}
      </div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12,
  fontFamily: "var(--sans)",
  background: "transparent",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  color: "var(--ink-soft)",
  cursor: "pointer",
  transition: "background 0.12s",
};

const btnPrimary: React.CSSProperties = {
  padding: "7px 16px",
  fontSize: 12,
  fontFamily: "var(--sans)",
  fontWeight: 600,
  background: "var(--ink)",
  border: "1px solid var(--ink)",
  borderRadius: 6,
  color: "var(--paper)",
  cursor: "pointer",
  transition: "background 0.12s",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
