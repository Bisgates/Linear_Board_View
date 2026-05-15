import { useEffect } from "react";

export interface ToastItem {
  id: string;
  kind: "info" | "success" | "error";
  msg: string;
}

interface ToastStackProps {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}

const KIND_COLOR: Record<ToastItem["kind"], { bg: string; border: string; fg: string }> = {
  info: { bg: "var(--panel)", border: "var(--hairline)", fg: "var(--ink)" },
  success: {
    bg: "var(--toast-success-bg)",
    border: "var(--toast-success-bd)",
    fg: "var(--toast-success-fg)",
  },
  error: {
    bg: "var(--toast-error-bg)",
    border: "var(--toast-error-bd)",
    fg: "var(--toast-error-fg)",
  },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), 4000);
    return () => clearTimeout(t);
  }, [item.id, onDismiss]);

  const c = KIND_COLOR[item.kind];

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        padding: "8px 12px",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "var(--sans)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        maxWidth: 360,
        cursor: "pointer",
      }}
      onClick={() => onDismiss(item.id)}
    >
      {item.msg}
    </div>
  );
}

export function ToastStack({ items, onDismiss }: ToastStackProps) {
  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      {items.map((t) => (
        <div key={t.id} style={{ pointerEvents: "auto" }}>
          <Toast item={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
