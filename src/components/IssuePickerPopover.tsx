import { useEffect, useMemo, useRef, useState } from "react";
import type { IssueRecord } from "../linear/types";

interface Props {
  issues: IssueRecord[];
  workingOnIds: Set<string>;
  onAdd: (issueId: string) => void;
}

export function IssuePickerPopover({ issues, workingOnIds, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (evt: MouseEvent) => {
      const t = evt.target as Element;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (iss) =>
        iss.identifier.toLowerCase().includes(q) ||
        iss.title.toLowerCase().includes(q),
    );
  }, [issues, query]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((s) => !s)}
        style={{
          border: "1px solid var(--hairline)",
          background: open ? "var(--paper-deep)" : "var(--paper-soft)",
          color: "var(--ink)",
          padding: "6px 12px",
          borderRadius: 4,
          fontFamily: "var(--sans)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        Add issue ▾
      </button>
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            width: 340,
            maxHeight: 460,
            display: "flex",
            flexDirection: "column",
            background: "var(--paper)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            boxShadow: "0 10px 30px rgba(26,24,20,0.18)",
            zIndex: 40,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search issues…"
              style={{
                width: "100%",
                border: "1px solid var(--hairline)",
                background: "var(--paper-soft)",
                padding: "6px 8px",
                fontFamily: "var(--sans)",
                fontSize: 12,
                color: "var(--ink)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 16, color: "var(--muted)", fontSize: 11 }}>no matches</div>
            )}
            {filtered.map((iss) => {
              const inBoard = workingOnIds.has(iss.id);
              return (
                <button
                  key={iss.id}
                  type="button"
                  disabled={inBoard}
                  onClick={() => {
                    if (inBoard) return;
                    onAdd(iss.id);
                  }}
                  title={inBoard ? "Already in Working On" : "Click to add to Working On"}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    border: "none",
                    borderBottom: "1px solid rgba(26,24,20,0.06)",
                    background: "transparent",
                    cursor: inBoard ? "default" : "pointer",
                    opacity: inBoard ? 0.45 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--sans)",
                    color: "var(--ink)",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (inBoard) return;
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(168,104,16,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--muted)",
                      minWidth: 56,
                      flexShrink: 0,
                    }}
                  >
                    {iss.identifier}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {iss.title}
                  </span>
                  {inBoard && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--forest)",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
