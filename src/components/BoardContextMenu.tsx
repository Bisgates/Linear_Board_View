import { useEffect, useRef } from "react";

/**
 * One row in the right-click menu. `tone` controls accent: `default` keeps
 * ink color, `danger` paints the row warm-red (used for delete-style actions).
 * Adding a new row anywhere in the canvas — note, issue, edge, future
 * pane-menu — just means appending to the `items` array; the menu component
 * stays generic.
 */
export interface MenuItem {
  /** Unique within a single menu render — used as the React key. */
  id: string;
  label: string;
  /** Optional only for `heading` rows — every actionable row should set it. */
  onSelect?: () => void;
  tone?: "default" | "danger";
  /** Optional disabled state — row stays visible but unclickable + dimmed. */
  disabled?: boolean;
  /** Renders a leading checkmark glyph. Used for radio-style groups (e.g. the
   *  root-direction picker on a mindmap root). */
  checked?: boolean;
  /** Render a thin top-divider before this row. Used to group radio-style
   *  options (e.g. Direction: Right / Left / Up / Down) below the regular
   *  actions, so the menu still reads as a single ordered list. */
  separatorAbove?: boolean;
  /** Non-interactive group label — rendered as a small dimmed uppercase row
   *  (no hover, no click, no checkmark slot). Used to caption radio groups
   *  when a menu carries more than one of them. */
  heading?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onDismiss: () => void;
}

/**
 * Minimal warm-paper context menu. Click outside / Esc / right-click anywhere
 * closes it. Each row is one `MenuItem` so callers can mix copy/delete/etc.
 * actions without growing the component.
 */
export function BoardContextMenu({ x, y, items, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dismiss = (evt: MouseEvent) => {
      if (ref.current && !ref.current.contains(evt.target as Element)) onDismiss();
    };
    // Right-click anywhere outside the menu re-opens / shifts the target — close
    // the current one so the new one (opened by CanvasBoard) doesn't stack on
    // top. Use capture so this runs before the new onContextMenu mounts a
    // replacement.
    const onAnyContextMenu = (evt: MouseEvent) => {
      if (ref.current && !ref.current.contains(evt.target as Element)) onDismiss();
    };
    const esc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("contextmenu", onAnyContextMenu, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("contextmenu", onAnyContextMenu, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: y,
        left: x,
        minWidth: 180,
        background: "var(--paper)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(26,24,20,0.18)",
        padding: 4,
        zIndex: 50,
        fontFamily: "var(--sans)",
      }}
    >
      {items.map((item) => {
        const danger = item.tone === "danger";
        const baseColor = danger ? "var(--warm-red)" : "var(--ink)";
        const hoverBg = danger ? "rgba(178,58,72,0.08)" : "rgba(26,24,20,0.06)";
        const row = item.heading ? (
          <div
            key={item.id}
            style={{
              padding: "5px 12px 2px",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--muted)",
              userSelect: "none",
            }}
          >
            {item.label}
          </div>
        ) : (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              // Run the action first, then dismiss — if the action throws we
              // still want the menu gone so the user isn't stuck with it.
              try {
                item.onSelect?.();
              } finally {
                onDismiss();
              }
            }}
            style={{
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              padding: "7px 12px",
              color: item.disabled ? "var(--muted)" : baseColor,
              fontSize: 12,
              fontWeight: danger ? 600 : 500,
              letterSpacing: "0.02em",
              cursor: item.disabled ? "not-allowed" : "pointer",
              borderRadius: 4,
              opacity: item.disabled ? 0.6 : 1,
              transition: "background 0.08s",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 12,
                textAlign: "center",
                color: "var(--ink)",
                opacity: item.checked ? 1 : 0,
                fontWeight: 700,
              }}
            >
              {/* leading checkmark slot — empty width is reserved so all rows
                  in the same menu align text regardless of checked state */}
              ✓
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
          </button>
        );
        if (item.separatorAbove) {
          return (
            <div key={`${item.id}-wrap`}>
              <div
                style={{
                  height: 1,
                  margin: "4px 8px",
                  background: "var(--hairline)",
                  opacity: 0.7,
                }}
              />
              {row}
            </div>
          );
        }
        return row;
      })}
    </div>
  );
}
