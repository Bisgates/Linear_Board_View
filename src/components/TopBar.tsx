import { useEffect, useState } from "react";

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

export type ActiveView = "all" | "working_on";

interface TopBarProps {
  lastSyncAt: string | null;
  syncing: boolean;
  onRefresh: () => void;
  issueCount: number;
  totalCount?: number;
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
  leftSlot?: React.ReactNode;
}

export function TopBar({
  lastSyncAt,
  syncing,
  onRefresh,
  issueCount,
  totalCount,
  activeView,
  onViewChange,
  leftSlot,
}: TopBarProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header
      style={{
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "var(--paper)",
        borderBottom: "1px solid var(--hairline)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 20,
            color: "var(--ink)",
            letterSpacing: "0.02em",
          }}
        >
          Linear Board
        </span>
        {leftSlot}
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {totalCount !== undefined && totalCount !== issueCount
            ? `${issueCount} / ${totalCount} issues`
            : `${issueCount} issue${issueCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ViewSwitcher value={activeView} onChange={onViewChange} />
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: "0.04em",
            fontFamily: "var(--mono)",
          }}
        >
          synced {formatRelative(lastSyncAt, now)}
        </span>
        <button
          onClick={onRefresh}
          disabled={syncing}
          style={{
            border: "1px solid var(--hairline)",
            background: syncing ? "var(--paper-deep)" : "var(--paper-soft)",
            color: "var(--ink)",
            padding: "6px 14px",
            borderRadius: 4,
            fontFamily: "var(--sans)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: syncing ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {syncing ? "Syncing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

function ViewSwitcher({ value, onChange }: { value: ActiveView; onChange: (v: ActiveView) => void }) {
  const items: { v: ActiveView; label: string }[] = [
    { v: "all", label: "All Issues" },
    { v: "working_on", label: "Working On" },
  ];
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        overflow: "hidden",
        background: "var(--paper-soft)",
      }}
    >
      {items.map((it, i) => {
        const active = value === it.v;
        return (
          <button
            key={it.v}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.v)}
            style={{
              border: "none",
              borderLeft: i === 0 ? "none" : "1px solid var(--hairline)",
              padding: "6px 12px",
              background: active ? "var(--paper-deep)" : "transparent",
              color: active ? "var(--ink)" : "var(--ink-soft)",
              fontFamily: "var(--sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
