import { useEffect, useRef } from "react";

export type ContextMenuTarget =
  | { kind: "issue"; id: string }
  | { kind: "note"; id: string }
  | { kind: "edge"; id: string };

interface Props {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onAction: (target: ContextMenuTarget) => void;
  onDismiss: () => void;
}

const LABEL: Record<ContextMenuTarget["kind"], string> = {
  issue: "Remove from board",
  note: "Delete note",
  edge: "Delete connection",
};

export function BoardContextMenu({ x, y, target, onAction, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (evt: MouseEvent) => {
      if (ref.current && !ref.current.contains(evt.target as Element)) onDismiss();
    };
    const esc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
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
        minWidth: 200,
        background: "var(--paper)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(26,24,20,0.18)",
        padding: 4,
        zIndex: 50,
        fontFamily: "var(--sans)",
      }}
    >
      <button
        onClick={() => onAction(target)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: "8px 12px",
          color: "var(--warm-red)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.04em",
          cursor: "pointer",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(178,58,72,0.08)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
      >
        {LABEL[target.kind]}
      </button>
    </div>
  );
}
