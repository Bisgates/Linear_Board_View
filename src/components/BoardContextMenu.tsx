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
  onSelect: () => void;
  tone?: "default" | "danger";
  /** Optional disabled state — row stays visible but unclickable + dimmed. */
  disabled?: boolean;
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
        return (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              // Run the action first, then dismiss — if the action throws we
              // still want the menu gone so the user isn't stuck with it.
              try {
                item.onSelect();
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
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
