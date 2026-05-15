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
}: Props) {
  const allowRename = kind === "custom";
  const createLabel = kind === "custom" ? "+ 新建 custom view" : "+ 新建 day view";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Click outside → close.
  useEffect(() => {
    const onDocDown = (evt: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(evt.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose]);

  // Esc → close.
  useEffect(() => {
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          const canDelete = views.length > 1;
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
              {!isEditing && (
                <button
                  type="button"
                  disabled={!canDelete}
                  title={canDelete ? "删除此 view" : "至少保留一个 view"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canDelete) return;
                    if (window.confirm(`删除 "${v.name}"？该 view 的位置与笔记将丢失。`)) {
                      onDelete(v.id);
                    }
                  }}
                  style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    border: "none",
                    background: "transparent",
                    color: canDelete ? "var(--muted)" : "var(--hairline)",
                    cursor: canDelete ? "pointer" : "not-allowed",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 3,
                  }}
                  onMouseEnter={(e) => {
                    if (canDelete) e.currentTarget.style.color = "var(--warm-red)";
                  }}
                  onMouseLeave={(e) => {
                    if (canDelete) e.currentTarget.style.color = "var(--muted)";
                  }}
                >
                  ×
                </button>
              )}
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
    </div>
  );
}
