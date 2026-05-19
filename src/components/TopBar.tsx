import { useEffect, useRef, useState } from "react";
import { TopBarMenu } from "./TopBarMenu";

export type ActiveView = "all" | "working_on" | "custom" | "agent_tmp";

interface TopBarProps {
  lastSyncAt: string | null;
  syncing: boolean;
  onRefresh: () => void;
  onOpenShortcuts: () => void;
  issueCount: number;
  totalCount?: number;
  activeView: ActiveView;
  onViewChange: (v: ActiveView) => void;
  /** Label for the Working On tab (current day view name). */
  workingOnLabel?: string;
  /** Click handler for the Working On ▾ split button. */
  onWorkingOnExpand?: (anchor: { x: number; y: number; width: number }) => void;
  /** Label for the Custom tab (current custom view name). */
  customLabel?: string;
  /** Click handler for the Custom ▾ split button. */
  onCustomExpand?: (anchor: { x: number; y: number; width: number }) => void;
  /** Double-click on the Custom tab commits a new name for the active custom view. */
  onRenameActiveCustom?: (name: string) => void;
  /** Sits between the left cluster and the right ViewSwitcher group. */
  centerSlot?: React.ReactNode;
  /**
   * Always-rendered chip that sits OUTSIDE the rest of the ViewSwitcher tabs
   * but to the immediate left of the "All Issues" tab. Pinning it here
   * (instead of conditionally inside the left zone) keeps the rest of the
   * top bar's horizontal layout stable when the active view changes — the
   * issue count and ViewSwitcher tabs no longer slide left/right.
   */
  addIssueSlot?: React.ReactNode;
  // Updater entry surfaced inside the hamburger menu (Tauri runtime only).
  showCheckUpdate?: boolean;
  checkUpdateBusy?: boolean;
  onCheckUpdate?: () => void;
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
  customLabel,
  onCustomExpand,
  onRenameActiveCustom,
  centerSlot,
  addIssueSlot,
  showCheckUpdate,
  checkUpdateBusy,
  onCheckUpdate,
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
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingLeft: 24,
          paddingRight: 24,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {centerSlot}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {addIssueSlot}
        <ViewSwitcher
          value={activeView}
          onChange={onViewChange}
          workingOnLabel={workingOnLabel}
          onWorkingOnExpand={onWorkingOnExpand}
          customLabel={customLabel}
          onCustomExpand={onCustomExpand}
          onRenameActiveCustom={onRenameActiveCustom}
        />
        <TopBarMenu
          lastSyncAt={lastSyncAt}
          syncing={syncing}
          onRefresh={onRefresh}
          onOpenShortcuts={onOpenShortcuts}
          showCheckUpdate={showCheckUpdate}
          checkUpdateBusy={checkUpdateBusy}
          onCheckUpdate={onCheckUpdate}
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
  customLabel,
  onCustomExpand,
  onRenameActiveCustom,
}: {
  value: ActiveView;
  onChange: (v: ActiveView) => void;
  workingOnLabel?: string;
  onWorkingOnExpand?: (anchor: { x: number; y: number; width: number }) => void;
  customLabel?: string;
  onCustomExpand?: (anchor: { x: number; y: number; width: number }) => void;
  onRenameActiveCustom?: (name: string) => void;
}) {
  const workingOnRef = useRef<HTMLDivElement | null>(null);
  const customRef = useRef<HTMLDivElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [editingCustom, setEditingCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  useEffect(() => {
    if (editingCustom && customInputRef.current) {
      customInputRef.current.focus();
      customInputRef.current.select();
    }
  }, [editingCustom]);

  const commitCustomRename = () => {
    const trimmed = customDraft.trim();
    if (trimmed && trimmed !== customLabel && onRenameActiveCustom) {
      onRenameActiveCustom(trimmed);
    }
    setEditingCustom(false);
    setCustomDraft("");
  };

  const cancelCustomRename = () => {
    setEditingCustom(false);
    setCustomDraft("");
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
          onClick={() => onChange("working_on")}
          title={workingOnLabel ? `Working On · ${workingOnLabel}` : "Working On"}
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
          {/* Suffix has a FIXED width (not maxWidth) so swapping the active
              day-view via `d` / dropdown doesn't change the tab's outer
              width — the rest of the bar stops sliding around. */}
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
              width: 140,
              display: "inline-block",
            }}
          >
            {workingOnLabel ? `· ${workingOnLabel}` : ""}
          </span>
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
      <div
        ref={customRef}
        role="group"
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          borderLeft: "1px solid var(--hairline)",
          background: value === "custom" ? "var(--paper-deep)" : "transparent",
        }}
      >
        <button
          role="tab"
          aria-selected={value === "custom"}
          onClick={() => {
            if (editingCustom) return;
            onChange("custom");
          }}
          onDoubleClick={() => {
            if (!onRenameActiveCustom || !customLabel) return;
            setCustomDraft(customLabel);
            setEditingCustom(true);
          }}
          title={
            editingCustom
              ? "Enter 提交 / Esc 取消"
              : customLabel
                ? `Custom · ${customLabel}（双击改名）`
                : "Custom"
          }
          style={{
            ...tabBtnStyle(value === "custom", false),
            background: "transparent",
            borderLeft: "none",
            paddingRight: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: 280,
          }}
        >
          <span>Custom</span>
          {editingCustom ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ opacity: 0.5 }}>·</span>
              <input
                ref={customInputRef}
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustomRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustomRename();
                  }
                  e.stopPropagation();
                }}
                onBlur={commitCustomRename}
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
                width: 100,
                display: "inline-block",
              }}
            >
              {customLabel ? `· ${customLabel}` : ""}
            </span>
          )}
        </button>
        <button
          aria-label="切换 Custom view"
          title="切换 / 新建 Custom view"
          onClick={() => {
            const el = customRef.current;
            if (!el || !onCustomExpand) return;
            const rect = el.getBoundingClientRect();
            onCustomExpand({ x: rect.left, y: rect.bottom + 4, width: rect.width });
          }}
          style={{
            ...tabBtnStyle(value === "custom", true),
            background: "transparent",
            borderLeft: "1px solid var(--hairline)",
            padding: "0 8px",
            fontSize: 9,
          }}
        >
          ▾
        </button>
      </div>
      <button
        role="tab"
        aria-selected={value === "agent_tmp"}
        onClick={() => onChange("agent_tmp")}
        title="OPUS team — agent 管理（临时视图）"
        style={{
          ...tabBtnStyle(value === "agent_tmp", false),
          borderLeft: "1px solid var(--hairline)",
        }}
      >
        Agent_tmp
      </button>
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
