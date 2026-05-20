import { useEffect, useRef, useState } from "react";
import type { ViewMeta } from "../lib/workingOnViews";

interface Props {
  views: ViewMeta[];
  activeId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Top-left anchor in viewport coords; component positions itself just below. */
  anchor: { x: number; y: number; width: number };
  /**
   * Determines the create-button copy and whether rows can be renamed inline.
   * Day views derive their names from the date and aren't user-renameable;
   * Custom views are free-form.
   */
  kind?: "day" | "custom";
  /** Custom-only: which view ids are already pinned (drives Pin/Unpin label). */
  pinnedIds?: Set<string>;
  /** Custom-only: pin a custom view to the top-bar strip. */
  onPin?: (id: string) => void;
  /** Custom-only: unpin a custom view from the top-bar strip. */
  onUnpin?: (id: string) => void;
}

interface ContextMenuState {
  viewId: string;
  x: number;
  y: number;
}

export function WorkingOnDropdown({
  views,
  activeId,
  onPick,
  onCreate,
  onRename,
  onDelete,
  onClose,
  anchor,
  kind = "day",
  pinnedIds,
  onPin,
  onUnpin,
}: Props) {
  const allowRename = kind === "custom";
  const allowPin = kind === "custom" && !!onPin && !!onUnpin;
  const createLabel = kind === "custom" ? "+ 新建 custom view" : "+ 新建 day view";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Two-click delete confirmation: first × tap arms the button (turns red,
  // shows "确认?"), second tap commits. Replaces `window.confirm()` which is
  // unreliable inside the Tauri WKWebView (returns false without surfacing a
  // dialog, so the original click did nothing visible).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Auto-disarm pending delete after 3s so a stray first click doesn't sit
  // ready forever.
  useEffect(() => {
    if (!pendingDeleteId) return;
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setPendingDeleteId(null);
      pendingTimerRef.current = null;
    }, 3000);
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [pendingDeleteId]);

  // Click outside → close. If a context menu is open, the first outside click
  // dismisses just the menu (matches platform context-menu conventions).
  useEffect(() => {
    const onDocDown = (evt: MouseEvent) => {
      const target = evt.target as Node;
      if (contextMenu && ctxMenuRef.current && ctxMenuRef.current.contains(target)) return;
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (!rootRef.current) return;
      if (rootRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose, contextMenu]);

  // Esc → dismiss context menu first, then disarm pending delete, then close.
  useEffect(() => {
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key !== "Escape") return;
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (pendingDeleteId) {
        setPendingDeleteId(null);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, contextMenu, pendingDeleteId]);

  const commit = (id: string) => {
    const trimmed = draft.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
    setDraft("");
  };

  const cancel = () => {
    setEditingId(null);
    setDraft("");
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      style={{
        position: "fixed",
        top: anchor.y,
        left: anchor.x,
        minWidth: Math.max(220, anchor.width),
        background: "var(--paper)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(26,24,20,0.18)",
        zIndex: 100,
        fontFamily: "var(--sans)",
        fontSize: 12,
        color: "var(--ink)",
        overflow: "hidden",
      }}
    >
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {views.map((v) => {
          const isActive = v.id === activeId;
          const isEditing = editingId === v.id;
          // Always allow delete: deleting the last view auto-creates a fresh
          // blank one (see useViewsList.deleteView), so the user never lands
          // in an empty-state UI.
          const canDelete = true;
          const isLastView = views.length === 1;
          return (
            <div
              key={v.id}
              role="menuitem"
              onClick={() => {
                if (isEditing) return;
                onPick(v.id);
                onClose();
              }}
              onDoubleClick={(evt) => {
                if (!allowRename) return;
                evt.stopPropagation();
                setEditingId(v.id);
                setDraft(v.name);
              }}
              onContextMenu={(evt) => {
                if (!allowPin) return;
                evt.preventDefault();
                evt.stopPropagation();
                setContextMenu({ viewId: v.id, x: evt.clientX, y: evt.clientY });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px 8px 12px",
                cursor: isEditing ? "default" : "pointer",
                background: isActive ? "var(--paper-deep)" : "transparent",
                borderBottom: "1px solid var(--hairline-soft, rgba(26,24,20,0.06))",
              }}
              onMouseEnter={(e) => {
                if (!isActive && !isEditing) e.currentTarget.style.background = "var(--paper-soft)";
              }}
              onMouseLeave={(e) => {
                if (!isActive && !isEditing) e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: isActive ? "var(--warm-red)" : "transparent",
                  border: isActive ? "none" : "1px solid var(--muted)",
                  flexShrink: 0,
                }}
              />
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit(v.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancel();
                    }
                  }}
                  onBlur={() => commit(v.id)}
                  style={{
                    flex: 1,
                    border: "1px solid var(--hairline)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    padding: "2px 6px",
                    fontFamily: "var(--sans)",
                    fontSize: 12,
                    borderRadius: 3,
                    outline: "none",
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: isActive ? "var(--ink)" : "var(--ink-soft)",
                    fontWeight: isActive ? 600 : 400,
                  }}
                  title={v.name}
                >
                  {v.name}
                </span>
              )}
              {!isEditing && (() => {
                const isPending = pendingDeleteId === v.id;
                const title = isPending
                  ? "再点一次确认删除"
                  : isLastView
                    ? "删除此 view（最后一个 view 删除后会自动新建一个空白 view）"
                    : "删除此 view";
                return (
                  <button
                    type="button"
                    title={title}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPending) {
                        // Second click → commit.
                        setPendingDeleteId(null);
                        onDelete(v.id);
                      } else {
                        // First click → arm.
                        setPendingDeleteId(v.id);
                      }
                    }}
                    style={{
                      flexShrink: 0,
                      // Pending state widens the button to hold "确认?" text.
                      width: isPending ? "auto" : 18,
                      minWidth: 18,
                      height: 18,
                      padding: isPending ? "0 6px" : 0,
                      border: isPending ? "1px solid var(--warm-red)" : "none",
                      background: isPending ? "var(--warm-red)" : "transparent",
                      color: isPending ? "var(--paper)" : canDelete ? "var(--muted)" : "var(--hairline)",
                      cursor: canDelete ? "pointer" : "not-allowed",
                      fontSize: isPending ? 11 : 14,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 3,
                      fontFamily: "var(--sans)",
                      letterSpacing: isPending ? "0.02em" : undefined,
                      transition: "background 120ms, color 120ms",
                    }}
                    onMouseEnter={(e) => {
                      if (isPending) return;
                      if (canDelete) e.currentTarget.style.color = "var(--warm-red)";
                    }}
                    onMouseLeave={(e) => {
                      if (isPending) return;
                      if (canDelete) e.currentTarget.style.color = "var(--muted)";
                    }}
                  >
                    {isPending ? "确认?" : "×"}
                  </button>
                );
              })()}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          onCreate();
          // Stay open so user sees the new entry; parent re-renders with new view list.
        }}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "8px 12px",
          border: "none",
          borderTop: "1px solid var(--hairline)",
          background: "var(--paper-soft)",
          color: "var(--ink-soft)",
          fontFamily: "var(--sans)",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-deep)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--paper-soft)")}
      >
        {createLabel}
      </button>
      {contextMenu && allowPin && (
        <div
          ref={ctxMenuRef}
          role="menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--paper)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(26,24,20,0.18)",
            zIndex: 101,
            fontFamily: "var(--sans)",
            fontSize: 12,
            color: "var(--ink)",
            overflow: "hidden",
            minWidth: 140,
          }}
        >
          {(() => {
            const isAlreadyPinned = !!pinnedIds?.has(contextMenu.viewId);
            const label = isAlreadyPinned ? "Unpin board" : "Pin board";
            return (
              <button
                type="button"
                onClick={() => {
                  if (isAlreadyPinned) onUnpin?.(contextMenu.viewId);
                  else onPin?.(contextMenu.viewId);
                  setContextMenu(null);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  background: "transparent",
                  color: "var(--ink)",
                  fontFamily: "var(--sans)",
                  fontSize: 12,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-soft)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {label}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
