import { useEffect, useMemo, useRef, useState } from "react";
import type { IssueRecord } from "../linear/types";
import { projectColor } from "../lib/projectColor";
import { Chevron } from "./TopBar";

interface Props {
  issues: IssueRecord[];
  workingOnIds: Set<string>;
  onAdd: (issueId: string) => void;
  /**
   * Which view the picker will write into. `null` means the active tab is
   * neither Working On nor Custom — render the button DISABLED (with a
   * tooltip) and keep its width so the surrounding TopBar layout doesn't
   * jiggle when the user toggles between All / Agent_tmp and Working On /
   * Custom.
   */
  targetView?: "working_on" | "custom" | null;
}

type Row =
  | { kind: "header"; key: string; team: string; project: string; projectColor: string }
  | { kind: "issue"; key: string; issue: IssueRecord };

function groupRows(issues: IssueRecord[]): Row[] {
  const teams = new Map<string, Map<string, IssueRecord[]>>();
  const teamNameOf = (iss: IssueRecord) => iss.team?.name ?? "No team";
  const projectNameOf = (iss: IssueRecord) => iss.project?.name ?? "No project";

  for (const iss of issues) {
    const t = teamNameOf(iss);
    const p = projectNameOf(iss);
    if (!teams.has(t)) teams.set(t, new Map());
    const tg = teams.get(t)!;
    if (!tg.has(p)) tg.set(p, []);
    tg.get(p)!.push(iss);
  }

  const ordered = Array.from(teams.entries()).sort(([a], [b]) => {
    if (a === "No team") return 1;
    if (b === "No team") return -1;
    return a.localeCompare(b);
  });

  const rows: Row[] = [];
  for (const [team, projects] of ordered) {
    const orderedProjs = Array.from(projects.entries()).sort(([a], [b]) => {
      if (a === "No project") return 1;
      if (b === "No project") return -1;
      return a.localeCompare(b);
    });
    for (const [project, list] of orderedProjs) {
      rows.push({
        kind: "header",
        key: `h:${team}::${project}`,
        team,
        project,
        projectColor: projectColor(project === "No project" ? null : project),
      });
      for (const iss of list) {
        rows.push({ kind: "issue", key: iss.id, issue: iss });
      }
    }
  }
  return rows;
}

export function IssuePickerPopover({ issues, workingOnIds, onAdd, targetView = "working_on" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const disabled = targetView === null;

  // Auto-close when the active view loses a writable target (so the popover
  // doesn't linger open while the chip itself becomes disabled).
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

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

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (iss) =>
        iss.identifier.toLowerCase().includes(q) ||
        iss.title.toLowerCase().includes(q) ||
        (iss.project?.name ?? "").toLowerCase().includes(q) ||
        (iss.team?.name ?? "").toLowerCase().includes(q),
    );
  }, [issues, query]);

  const rows = useMemo(() => groupRows(filteredIssues), [filteredIssues]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        onClick={() => {
          if (disabled) return;
          setOpen((s) => !s);
        }}
        disabled={disabled}
        title={
          disabled
            ? "Switch to Working On / Custom to add issues"
            : targetView === "custom"
              ? "Add an issue to the active Custom view"
              : "Add an issue to the active Working On view"
        }
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
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          transition: "background 0.15s, opacity 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Add issue
          <Chevron />
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            width: 360,
            maxHeight: 520,
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
              placeholder="Search issues, project, team…"
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
            {rows.length === 0 && (
              <div style={{ padding: 16, color: "var(--muted)", fontSize: 11 }}>no matches</div>
            )}
            {rows.map((row) =>
              row.kind === "header" ? (
                <div
                  key={row.key}
                  style={{
                    padding: "10px 12px 4px 12px",
                    background: "var(--paper)",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    fontFamily: "var(--sans)",
                    borderTop: "1px solid rgba(26,24,20,0.06)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {row.team}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--muted)",
                    }}
                  >
                    ›
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      color: row.projectColor,
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    {row.project}
                  </span>
                </div>
              ) : (
                (() => {
                  const iss = row.issue;
                  const inBoard = workingOnIds.has(iss.id);
                  return (
                    <button
                      key={row.key}
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
                        padding: "6px 12px 6px 20px",
                        border: "none",
                        borderBottom: "1px solid rgba(26,24,20,0.04)",
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
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "rgba(168,104,16,0.08)";
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
                          minWidth: 48,
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
                })()
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
