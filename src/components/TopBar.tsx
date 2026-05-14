import { useEffect, useRef, useState } from "react";
import { TopBarMenu } from "./TopBarMenu";

export type ActiveView = "all" | "working_on";

interface TopBarProps {
  lastSyncAt: string | null;
  syncing: boolean;
  onRefresh: () => void;
  onOpenShortcuts: () => void;
  issueCount: number;
  totalCount?: number;
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
  /** Optional label for the Working On tab (current view name). */
  workingOnLabel?: string;
  /** Click handler for the ▾ split button. The parent positions the dropdown using the rect handed back. */
  onWorkingOnExpand?: (anchor: { x: number; y: number; width: number }) => void;
  /** Double-click on the Working On tab commits a new name for the active view. */
  onRenameActiveWorkingOn?: (name: string) => void;
  leftSlot?: React.ReactNode;
}

export function TopBar({
  lastSyncAt,
  syncing,
  onRefresh,
  onOpenShortcuts,
  issueCount,
  totalCount,
  activeView,
  onViewChange,
  workingOnLabel,
  onWorkingOnExpand,
  onRenameActiveWorkingOn,
  leftSlot,
}: TopBarProps) {
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
        <ViewSwitcher
          value={activeView}
          onChange={onViewChange}
          workingOnLabel={workingOnLabel}
          onWorkingOnExpand={onWorkingOnExpand}
          onRenameActiveWorkingOn={onRenameActiveWorkingOn}
        />
        <TopBarMenu
          lastSyncAt={lastSyncAt}
          syncing={syncing}
          onRefresh={onRefresh}
          onOpenShortcuts={onOpenShortcuts}
        />
      </div>
    </header>
  );
}

function ViewSwitcher({
  value,
  onChange,
  workingOnLabel,
  onWorkingOnExpand,
  onRenameActiveWorkingOn,
}: {
  value: ActiveView;
  onChange: (v: ActiveView) => void;
  workingOnLabel?: string;
  onWorkingOnExpand?: (anchor: { x: number; y: number; width: number }) => void;
  onRenameActiveWorkingOn?: (name: string) => void;
}) {
  const workingOnRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== workingOnLabel && onRenameActiveWorkingOn) {
      onRenameActiveWorkingOn(trimmed);
    }
    setEditing(false);
    setDraft("");
  };

  const cancelRename = () => {
    setEditing(false);
    setDraft("");
  };

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
      <button
        role="tab"
        aria-selected={value === "all"}
        onClick={() => onChange("all")}
        style={tabBtnStyle(value === "all", false)}
      >
        All Issues
      </button>
      <div
        ref={workingOnRef}
        role="group"
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          borderLeft: "1px solid var(--hairline)",
          background: value === "working_on" ? "var(--paper-deep)" : "transparent",
        }}
      >
        <button
          role="tab"
          aria-selected={value === "working_on"}
          onClick={() => {
            if (editing) return;
            onChange("working_on");
          }}
          onDoubleClick={() => {
            if (!onRenameActiveWorkingOn || !workingOnLabel) return;
            setDraft(workingOnLabel);
            setEditing(true);
          }}
          title={
            editing
              ? "Enter 提交 / Esc 取消"
              : workingOnLabel
                ? `Working On · ${workingOnLabel}（双击改名）`
                : "Working On"
          }
          style={{
            ...tabBtnStyle(value === "working_on", false),
            background: "transparent",
            borderLeft: "none",
            paddingRight: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: 280,
          }}
        >
          <span>Working On</span>
          {editing ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ opacity: 0.5 }}>·</span>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                  e.stopPropagation();
                }}
                onBlur={commitRename}
                style={{
                  width: 160,
                  border: "1px solid var(--hairline)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  padding: "2px 6px",
                  fontFamily: "var(--sans)",
                  fontSize: 11,
                  fontWeight: 400,
                  textTransform: "none",
                  letterSpacing: 0,
                  borderRadius: 3,
                  outline: "none",
                }}
              />
            </span>
          ) : (
            workingOnLabel && (
              <span
                style={{
                  fontWeight: 400,
                  opacity: 0.7,
                  textTransform: "none",
                  letterSpacing: 0,
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 200,
                }}
              >
                · {workingOnLabel}
              </span>
            )
          )}
        </button>
        <button
          aria-label="切换 Working On view"
          title="切换 / 新建 Working On view"
          onClick={() => {
            const el = workingOnRef.current;
            if (!el || !onWorkingOnExpand) return;
            const rect = el.getBoundingClientRect();
            onWorkingOnExpand({ x: rect.left, y: rect.bottom + 4, width: rect.width });
          }}
          style={{
            ...tabBtnStyle(value === "working_on", true),
            background: "transparent",
            borderLeft: "1px solid var(--hairline)",
            padding: "0 8px",
            fontSize: 9,
          }}
        >
          ▾
        </button>
      </div>
    </div>
  );
}

function tabBtnStyle(active: boolean, dense: boolean): React.CSSProperties {
  return {
    border: "none",
    padding: dense ? "6px 0" : "6px 12px",
    background: active ? "var(--paper-deep)" : "transparent",
    color: active ? "var(--ink)" : "var(--ink-soft)",
    fontFamily: "var(--sans)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "background 0.15s",
  };
}
