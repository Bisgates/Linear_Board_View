import { useEffect } from "react";

interface ShortcutRow {
  keys: string[];
  scope: string;
  desc: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ["↑ ↓ ← →"], scope: "Mindmap", desc: "Move halo to the spatially nearest card in that direction (±45° cone)" },
  { keys: ["Space"], scope: "Mindmap", desc: "Note → enter inline edit; issue → open DetailPanel" },
  { keys: ["Esc"], scope: "Mindmap", desc: "Exit note edit (halo stays on the card)" },
  { keys: ["Tab"], scope: "Mindmap", desc: "Generate a child note to the right; inherits parent color (issue parent → sage default). Dumb insert — may overlap, press F to tidy." },
  { keys: ["⇧ Tab"], scope: "Mindmap", desc: "Generate a sibling note below under the same parent (root → spawns same-column root, no edge)" },
  { keys: ["F"], scope: "Mindmap", desc: "Tidy the focused card's local subtree — that card stays pinned, its descendants fan out right. Does NOT climb to the global root. No-op with a hint toast if nothing is focused." },
  { keys: ["⇧ F"], scope: "Mindmap", desc: "Tidy every root subtree on the canvas, stacked vertically by current Y" },
  { keys: ["C"], scope: "Canvas", desc: "Connect mode: clicks pair up (a→b, c→d, …). Click empty pane / Esc / C exits" },
  { keys: ["U"], scope: "Canvas", desc: "Undo last action (up to 50 steps)" },
  { keys: ["⇧ U"], scope: "Canvas", desc: "Redo (undo the undo)" },
  { keys: ["G"], scope: "Canvas", desc: "Group selected cards for moving together (movement only); press G on a whole group to ungroup" },
  { keys: ["⌘ C", "Ctrl C"], scope: "Canvas", desc: "Copy current selection (cards + notes + their internal edges) to in-memory buffer" },
  { keys: ["⌘ V", "Ctrl V"], scope: "Canvas", desc: "Paste buffer into current view, centred on the viewport; duplicate issues are skipped" },
  { keys: ["Esc"], scope: "Global", desc: "Cancel link mode / leave edit / close menus" },
  { keys: ["⌘ Enter", "Ctrl Enter"], scope: "Note edit", desc: "Commit note edit; plain Enter inserts newline" },
  { keys: ["Delete", "Backspace"], scope: "Canvas", desc: "Delete selected node(s) or edge(s)" },
  { keys: ["double-click empty"], scope: "Canvas", desc: "Create a new note at the cursor; textarea auto-focuses" },
  { keys: ["double-click edge"], scope: "Canvas", desc: "Edit edge label at midpoint" },
  { keys: ["drag empty pane"], scope: "All views", desc: "Box select — touch is enough, no need to fully cover" },
  { keys: ["two-finger scroll"], scope: "All views", desc: "Pan the canvas" },
  { keys: ["pinch"], scope: "All views", desc: "Zoom in / out" },
  { keys: ["A"], scope: "View switch", desc: "Switch to Agent_tmp" },
  { keys: ["S"], scope: "View switch", desc: "Switch to All Issues" },
  { keys: ["D"], scope: "View switch", desc: "Switch to latest Working On day view" },
  { keys: ["1 - 9"], scope: "View switch", desc: "Activate the Nth pinned custom view (right-click a Custom dropdown row to pin)" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(26,24,20,0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          border: "1px solid var(--hairline)",
          borderRadius: 8,
          padding: "20px 24px 18px 24px",
          minWidth: 460,
          maxWidth: 620,
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(26,24,20,0.32)",
          fontFamily: "var(--sans)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <span
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: 20,
              color: "var(--ink)",
            }}
          >
            Keyboard shortcuts
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto 1fr",
            gap: "8px 16px",
            alignItems: "baseline",
            fontSize: 12,
            color: "var(--ink-soft)",
          }}
        >
          {SHORTCUTS.map((s, i) => (
            <Row key={i} {...s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ keys, scope, desc }: ShortcutRow) {
  return (
    <>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {keys.map((k) => (
          <kbd
            key={k}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              background: "var(--paper-soft)",
              border: "1px solid var(--hairline)",
              borderRadius: 3,
              padding: "2px 6px",
              color: "var(--ink)",
              whiteSpace: "nowrap",
            }}
          >
            {k}
          </kbd>
        ))}
      </div>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {scope}
      </span>
      <span style={{ color: "var(--ink)" }}>{desc}</span>
    </>
  );
}
