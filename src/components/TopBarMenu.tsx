import { useEffect, useRef, useState } from "react";
import pkg from "../../package.json";

const APP_VERSION: string = pkg.version;

interface Props {
  lastSyncAt: string | null;
  syncing: boolean;
  onRefresh: () => void;
  onOpenShortcuts: () => void;
  // Updater entry — only shown when `showCheckUpdate` is true (Tauri runtime).
  // `checkUpdateBusy` greys the item out while a check/install is in flight so
  // the user can't double-fire.
  showCheckUpdate?: boolean;
  checkUpdateBusy?: boolean;
  onCheckUpdate?: () => void;
}

function formatRelative(isoOrNull: string | null, nowMs: number): string {
  if (!isoOrNull) return "never";
  const then = new Date(isoOrNull).getTime();
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function TopBarMenu({
  lastSyncAt,
  syncing,
  onRefresh,
  onOpenShortcuts,
  showCheckUpdate,
  checkUpdateBusy,
  onCheckUpdate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (evt: MouseEvent) => {
      const t = evt.target as Element;
      if (popRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((s) => !s)}
        aria-label="menu"
        style={{
          border: "1px solid var(--hairline)",
          background: open ? "var(--paper-deep)" : "var(--paper-soft)",
          color: "var(--ink)",
          padding: "6px 10px",
          borderRadius: 4,
          cursor: "pointer",
          transition: "background 0.15s",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          lineHeight: 0,
        }}
      >
        <BurgerIcon />
      </button>
      {open && (
        <div
          ref={popRef}
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            minWidth: 240,
            background: "var(--paper)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            boxShadow: "0 10px 30px rgba(26,24,20,0.18)",
            zIndex: 40,
            overflow: "hidden",
            padding: 4,
            fontFamily: "var(--sans)",
          }}
        >
          <MenuItem
            label={syncing ? "Syncing…" : "Refresh"}
            hint={`synced ${formatRelative(lastSyncAt, now)}`}
            disabled={syncing}
            onClick={() => {
              if (syncing) return;
              setOpen(false);
              onRefresh();
            }}
          />
          {showCheckUpdate && onCheckUpdate && (
            <>
              <Separator />
              <MenuItem
                label={checkUpdateBusy ? "Checking…" : "Check Update"}
                hint={`v${APP_VERSION}`}
                disabled={checkUpdateBusy}
                onClick={() => {
                  if (checkUpdateBusy) return;
                  setOpen(false);
                  onCheckUpdate();
                }}
              />
            </>
          )}
          <Separator />
          <MenuItem
            label="Keyboard shortcuts"
            hint="?"
            onClick={() => {
              setOpen(false);
              onOpenShortcuts();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        color: "var(--ink)",
        fontFamily: "var(--sans)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.1s",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(168,104,16,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <span>{label}</span>
      {hint && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--muted)",
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function Separator() {
  return <div style={{ height: 1, background: "var(--hairline)", margin: "4px 0" }} />;
}

function BurgerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="1.6" fill="currentColor" />
      <rect x="2" y="7.2" width="12" height="1.6" fill="currentColor" />
      <rect x="2" y="10.9" width="12" height="1.6" fill="currentColor" />
    </svg>
  );
}
