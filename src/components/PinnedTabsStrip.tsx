import { useRef, useState } from "react";
import { BoardContextMenu, type MenuItem } from "./BoardContextMenu";

export interface PinnedTabEntry {
  viewId: string;
  name: string;
}

interface Props {
  tabs: PinnedTabEntry[];
  activeViewId: string | null;
  onActivate: (viewId: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  /** Right-click → "Unpin tab" → removes the chip from the strip. */
  onUnpin: (viewId: string) => void;
}

// Position + payload for the right-click context menu. Coordinates are
// page-relative (clientX/Y + scroll) because BoardContextMenu uses
// `position: absolute` against the document body.
interface MenuState {
  x: number;
  y: number;
  viewId: string;
}

interface DropTarget {
  index: number;
  side: "left" | "right";
}

// Distance the pointer must travel before a mousedown promotes to a drag.
// Below the threshold the gesture stays a click → onActivate.
const DRAG_THRESHOLD = 4;

// HTML5 DnD is blocked by Tauri's WebKit webview (the OS-level drag handler
// hijacks the event for file-into-app). Pointer events bypass that entirely
// — they're synthesized from the trackpad/mouse stream and don't talk to
// macOS's drag service.
export function PinnedTabsStrip({
  tabs,
  activeViewId,
  onActivate,
  onReorder,
  onUnpin,
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Per-pointer-gesture state. None of this needs to trigger re-render —
  // visual feedback is driven by `dragIdx` + `dropTarget` above.
  const pressedIdxRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);

  if (tabs.length === 0) return null;

  // Translate a clientX inside the strip into "insert before index k" by
  // walking each chip's midpoint. Falls back to end-of-list if we're past
  // the right edge of the last chip.
  const computeDropTarget = (clientX: number): DropTarget | null => {
    const strip = stripRef.current;
    if (!strip) return null;
    const chipEls = Array.from(strip.children) as HTMLElement[];
    for (let i = 0; i < chipEls.length; i++) {
      const rect = chipEls[i]!.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return { index: i, side: "left" };
      if (clientX <= rect.right) return { index: i, side: "right" };
    }
    // Past the last chip → drop to the rightmost slot.
    return { index: chipEls.length - 1, side: "right" };
  };

  const finalize = (target: DropTarget | null) => {
    const from = pressedIdxRef.current;
    pressedIdxRef.current = null;
    draggingRef.current = false;
    setDragIdx(null);
    setDropTarget(null);
    if (from === null || target === null) return;
    const insertIdx = target.side === "right" ? target.index + 1 : target.index;
    if (insertIdx === from || insertIdx === from + 1) return;
    onReorder(from, insertIdx);
  };

  const menuItems: MenuItem[] = menu
    ? [
        {
          id: "unpin",
          label: "Unpin tab",
          tone: "danger",
          onSelect: () => onUnpin(menu.viewId),
        },
      ]
    : [];

  return (
    <>
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Pinned custom views"
      style={{
        display: "inline-flex",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        overflow: "hidden",
        background: "var(--paper-soft)",
        userSelect: "none",
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
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              pressedIdxRef.current = idx;
              startXRef.current = e.clientX;
              draggingRef.current = false;
              // Capture so subsequent move/up fire on this element even if
              // the cursor leaves it.
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* setPointerCapture can throw on some pointer types — harmless */
              }
            }}
            onPointerMove={(e) => {
              if (pressedIdxRef.current === null) return;
              if (!draggingRef.current) {
                if (Math.abs(e.clientX - startXRef.current) < DRAG_THRESHOLD) return;
                draggingRef.current = true;
                setDragIdx(pressedIdxRef.current);
              }
              const next = computeDropTarget(e.clientX);
              if (
                next &&
                (next.index !== dropTarget?.index || next.side !== dropTarget?.side)
              ) {
                setDropTarget(next);
              }
            }}
            onPointerUp={(e) => {
              if (pressedIdxRef.current === null) return;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* releasePointerCapture can throw if capture was already lost */
              }
              if (draggingRef.current) {
                const target = computeDropTarget(e.clientX);
                finalize(target);
              } else {
                // No drag → treat as plain click → activate.
                const from = pressedIdxRef.current;
                pressedIdxRef.current = null;
                draggingRef.current = false;
                if (from !== null) onActivate(tabs[from]!.viewId);
              }
            }}
            onPointerCancel={() => {
              pressedIdxRef.current = null;
              draggingRef.current = false;
              setDragIdx(null);
              setDropTarget(null);
            }}
            onContextMenu={(e) => {
              // Right-click opens the unpin menu. Cancel any pointer-down
              // drag bookkeeping that the browser may have started — the
              // gesture turned into a context-menu invocation, not a drag.
              e.preventDefault();
              e.stopPropagation();
              pressedIdxRef.current = null;
              draggingRef.current = false;
              setDragIdx(null);
              setDropTarget(null);
              setMenu({ x: e.clientX, y: e.clientY, viewId: tab.viewId });
            }}
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
              touchAction: "none",
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
    {menu && (
      <BoardContextMenu
        x={menu.x}
        y={menu.y}
        items={menuItems}
        onDismiss={() => setMenu(null)}
      />
    )}
    </>
  );
}
