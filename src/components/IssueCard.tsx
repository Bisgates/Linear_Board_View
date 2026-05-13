import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { IssueRecord } from "../linear/types";
import { projectColor } from "../lib/projectColor";

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  background: "var(--paper)",
  border: "1.5px solid var(--ink-soft)",
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "med",
  4: "low",
};

/* Muted-but-distinct on warm cream paper */
const PRIORITY_COLOR: Record<number, string> = {
  0: "#8b8170", // muted
  1: "#b23a48", // warm-red
  2: "#a86810", // amber
  3: "#1e5a8a", // slate
  4: "#2f5c3f", // forest
};

const STATE_COLOR: Record<string, string> = {
  backlog: "#8b8170",
  unstarted: "#4a4438",
  started: "#a86810",
  completed: "#2f5c3f",
  canceled: "#8b8170",
  triage: "#6c3483",
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
  const stateColor = STATE_COLOR[data.state.type] ?? "#8b8170";
  const prioColor = PRIORITY_COLOR[data.priority] ?? "#8b8170";
  const prioLabel = PRIORITY_LABEL[data.priority] ?? "none";
  const av = data.assignee ? avatarChip(data.assignee.name) : null;
  const projColor = projectColor(data.project?.name);

  return (
    <div
      style={{
        width: 280,
        background: "var(--paper-soft)",
        border: `2px solid ${projColor}`,
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: selected
          ? `0 0 0 3px ${projColor}40, 0 4px 14px rgba(26,24,20,0.12)`
          : "0 1px 0 rgba(26,24,20,0.04)",
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
              color: "var(--paper)",
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
                background: l.color || "#8b8170",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const IssueCard = memo(IssueCardImpl);
