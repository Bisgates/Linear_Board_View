import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { IssueRecord } from "../linear/types";
import { projectColor } from "../lib/projectColor";

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  background: "var(--canvas)",
  border: "1.5px solid var(--ink-soft)",
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "med",
  4: "low",
};

/* Theme-driven CSS variable refs — every colour token lives in src/index.css. */
const PRIORITY_VAR: Record<number, string> = {
  0: "var(--prio-none)",
  1: "var(--prio-urgent)",
  2: "var(--prio-high)",
  3: "var(--prio-med)",
  4: "var(--prio-low)",
};

const STATE_VAR: Record<string, string> = {
  backlog: "var(--status-backlog)",
  unstarted: "var(--status-unstarted)",
  started: "var(--status-started)",
  completed: "var(--status-completed)",
  canceled: "var(--status-canceled)",
  triage: "var(--status-triage)",
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarChip(name: string): { initials: string; bg: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return {
    initials: (first + last).toUpperCase(),
    bg: `hsl(${hashHue(name)}, 35%, 38%)`,
  };
}

type Props = NodeProps & { data: IssueRecord };

function IssueCardImpl({ data, selected }: Props) {
  const stateColor = STATE_VAR[data.state.type] ?? "var(--muted)";
  const prioColor = PRIORITY_VAR[data.priority] ?? "var(--muted)";
  const prioLabel = PRIORITY_LABEL[data.priority] ?? "none";
  const av = data.assignee ? avatarChip(data.assignee.name) : null;
  const projColor = projectColor(data.project?.name);

  return (
    <div
      style={{
        width: 280,
        background: "var(--card)",
        // Default theme: 2px project-colour frame. The figma theme drops it
        // via `--issue-border: none`; the fallback keeps the project border
        // (nested var so `projColor` stays a live `var(--proj-N)` ref).
        border: `var(--issue-border, 2px solid ${projColor})`,
        borderRadius: 8,
        padding: "10px 12px",
        // Selected glow tints the project frame colour at ~28% so it matches
        // whichever project this card belongs to. color-mix is required because
        // projColor is a `var(--proj-N)` ref, so hex+alpha concatenation
        // (`${projColor}40`) wouldn't produce a valid CSS colour. The figma
        // theme swaps in a crisp blue ring via `--issue-selected-shadow`.
        boxShadow: selected
          ? `var(--issue-selected-shadow, 0 0 0 3px color-mix(in srgb, ${projColor} 28%, transparent), 0 4px 14px rgba(0,0,0,0.14))`
          : "var(--card-shadow)",
        color: "var(--ink)",
        cursor: "grab",
        transition: "box-shadow 0.12s",
      }}
    >
      <Handle id="t" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="r" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="l" type="source" position={Position.Left} style={HANDLE_STYLE} />
      {/* top row: project + identifier */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color: "var(--muted)",
          marginBottom: 4,
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ textTransform: "uppercase", color: projColor, fontWeight: 600 }}>
          {data.project?.name ?? "—"}
        </span>
        <span style={{ fontFamily: "var(--mono)" }}>{data.identifier}</span>
      </div>

      {/* title */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.3,
          marginBottom: 8,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {data.title}
      </div>

      {/* meta row: priority, state, assignee */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            title={`priority ${prioLabel}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: prioColor,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: prioColor,
                display: "inline-block",
              }}
            />
            {prioLabel}
          </span>
          <span
            title={data.state.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--ink-soft)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: stateColor,
                display: "inline-block",
              }}
            />
            {data.state.name}
          </span>
        </div>
        {av ? (
          <span
            title={data.assignee?.name ?? ""}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: av.bg,
              color: "var(--canvas)",
              fontSize: 10,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {av.initials}
          </span>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>

      {/* labels: bottom row of color dots */}
      {data.labels.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {data.labels.slice(0, 6).map((l) => (
            <span
              key={l.id}
              title={l.name}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: l.color || "var(--muted)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const IssueCard = memo(IssueCardImpl);
