import { useState } from "react";

export interface PinnedTabEntry {
  viewId: string;
  name: string;
}

interface Props {
  tabs: PinnedTabEntry[];
  activeViewId: string | null;
  onActivate: (viewId: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
}

interface DropTarget {
  index: number;
  side: "left" | "right";
}

export function PinnedTabsStrip({ tabs, activeViewId, onActivate, onReorder }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  if (tabs.length === 0) return null;

  const finalizeDrop = (overIdx: number, side: "left" | "right") => {
    if (dragIdx === null) return;
    const insertIdx = side === "right" ? overIdx + 1 : overIdx;
    if (insertIdx !== dragIdx && insertIdx !== dragIdx + 1) {
      onReorder(dragIdx, insertIdx);
    }
    setDragIdx(null);
    setDropTarget(null);
  };

  return (
    <div
      role="tablist"
      aria-label="Pinned custom views"
      style={{
        display: "inline-flex",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        overflow: "hidden",
        background: "var(--paper-soft)",
      }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.viewId === activeViewId;
        const isDragging = dragIdx === idx;
        const showLeftCue =
          dropTarget?.index === idx && dropTarget.side === "left" && dragIdx !== null;
        const showRightCue =
          dropTarget?.index === idx && dropTarget.side === "right" && dragIdx !== null;
        return (
          <button
            key={tab.viewId}
            role="tab"
            aria-selected={isActive}
            draggable
            onDragStart={(e) => {
              setDragIdx(idx);
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", tab.viewId);
              } catch {
                // setData can fail in some niche cases (e.g. SSR shim); harmless.
              }
            }}
            onDragOver={(e) => {
              if (dragIdx === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const mid = rect.left + rect.width / 2;
              const side: "left" | "right" = e.clientX < mid ? "left" : "right";
              if (dropTarget?.index !== idx || dropTarget.side !== side) {
                setDropTarget({ index: idx, side });
              }
            }}
            onDragLeave={(e) => {
              const next = e.relatedTarget;
              if (next instanceof Node && e.currentTarget.contains(next)) return;
              if (dropTarget?.index === idx) setDropTarget(null);
            }}
            onDrop={(e) => {
              if (dragIdx === null) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const mid = rect.left + rect.width / 2;
              const side: "left" | "right" = e.clientX < mid ? "left" : "right";
              finalizeDrop(idx, side);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDropTarget(null);
            }}
            onClick={() => onActivate(tab.viewId)}
            title={`Custom · ${tab.name}  (press ${idx + 1})`}
            style={{
              border: "none",
              borderLeft: idx === 0 ? "none" : "1px solid var(--hairline)",
              boxShadow: showLeftCue
                ? "inset 2px 0 0 0 var(--warm-red)"
                : showRightCue
                  ? "inset -2px 0 0 0 var(--warm-red)"
                  : undefined,
              padding: "6px 10px",
              background: isActive ? "var(--paper-deep)" : "transparent",
              color: isActive ? "var(--ink)" : "var(--ink-soft)",
              fontFamily: "var(--sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: dragIdx !== null ? "grabbing" : "grab",
              transition: "background 0.15s",
              opacity: isDragging ? 0.4 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 220,
            }}
          >
            <span style={{ opacity: 0.55 }}>{idx + 1}</span>
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tab.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
