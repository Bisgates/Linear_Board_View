import { useEffect } from "react";

interface ShortcutRow {
  keys: string[];
  scope: string;
  desc: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ["X"], scope: "Working On", desc: "Linking mode: click source → click target (or empty pane → spawns linked note)" },
  { keys: ["C"], scope: "Working On", desc: "Undo last action (up to 50 steps)" },
  { keys: ["Esc"], scope: "Global", desc: "Cancel link mode / leave edit / close menus" },
  { keys: ["⌘ Enter", "Ctrl Enter"], scope: "Note edit", desc: "Commit note edit; plain Enter inserts newline" },
  { keys: ["Delete", "Backspace"], scope: "Working On", desc: "Delete selected node(s) or edge(s)" },
  { keys: ["double-click empty"], scope: "Working On", desc: "Create a new note at the cursor; textarea auto-focuses" },
  { keys: ["double-click edge"], scope: "Working On", desc: "Edit edge label at midpoint" },
  { keys: ["drag empty pane"], scope: "All views", desc: "Box select — touch is enough, no need to fully cover" },
  { keys: ["two-finger scroll"], scope: "All views", desc: "Pan the canvas" },
  { keys: ["pinch"], scope: "All views", desc: "Zoom in / out" },
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
