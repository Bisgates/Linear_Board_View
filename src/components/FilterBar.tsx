import { useEffect, useState } from "react";
import type { FilterOptions, FilterState } from "../lib/filter";
import { isFilterEmpty } from "../lib/filter";
import { projectColor } from "../lib/projectColor";

interface FilterBarProps {
  filter: FilterState;
  options: FilterOptions;
  onChange: (next: FilterState) => void;
}

// Theme-driven CSS var refs (see src/index.css for token contract).
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

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

interface ChipProps {
  active: boolean;
  label: string;
  count?: number;
  color?: string;
  onClick: () => void;
}

function Chip({ active, label, count, color, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? color ?? "var(--ink)" : "var(--hairline)"}`,
        // `color` is a `var(--…)` ref so we mix instead of concatenating
        // hex+alpha. ~14% mix matches the previous `${color}1f` (= 12%).
        background: active
          ? color
            ? `color-mix(in srgb, ${color} 14%, transparent)`
            : "var(--accent-soft)"
          : "transparent",
        color: active ? "var(--ink)" : "var(--ink-soft)",
        fontSize: 11,
        fontFamily: "var(--sans)",
        cursor: "pointer",
        fontWeight: active ? 600 : 500,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      {color && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: color,
            display: "inline-block",
          }}
        />
      )}
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
      )}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: "var(--muted)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginRight: 2,
        }}
      >
        {title}
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

export function FilterBar({ filter, options, onChange }: FilterBarProps) {
  const [text, setText] = useState(filter.text);

  // Debounce text input by 200ms.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== filter.text) onChange({ ...filter, text });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Keep local text in sync when external clears it (e.g., reset)
  useEffect(() => {
    if (filter.text === "" && text !== "") setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.text]);

  const reset = () =>
    onChange({
      text: "",
      states: new Set(),
      priorities: new Set(),
      projects: new Set(),
      assignees: new Set(),
    });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 20px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--hairline)",
        flexShrink: 0,
        flexWrap: "wrap",
        rowGap: 8,
      }}
    >
      <input
        type="text"
        placeholder="Search title or identifier…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: 220,
          padding: "5px 10px",
          fontSize: 12,
          fontFamily: "var(--sans)",
          background: "var(--panel-soft)",
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          color: "var(--ink)",
          outline: "none",
        }}
      />

      <Group title="State">
        {options.states.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            count={o.count}
            color={STATE_VAR[o.value]}
            active={filter.states.has(o.value)}
            onClick={() => onChange({ ...filter, states: toggle(filter.states, o.value) })}
          />
        ))}
      </Group>

      <Group title="Priority">
        {options.priorities.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            count={o.count}
            color={PRIORITY_VAR[o.value]}
            active={filter.priorities.has(o.value)}
            onClick={() => onChange({ ...filter, priorities: toggle(filter.priorities, o.value) })}
          />
        ))}
      </Group>

      <Group title="Project">
        {options.projects.map((o) => (
          <Chip
            key={o.value || "__none__"}
            label={o.label}
            count={o.count}
            color={o.value ? projectColor(o.value) : undefined}
            active={filter.projects.has(o.value)}
            onClick={() => onChange({ ...filter, projects: toggle(filter.projects, o.value) })}
          />
        ))}
      </Group>

      <Group title="Assignee">
        {options.assignees.map((o) => (
          <Chip
            key={o.value || "__none__"}
            label={o.label}
            count={o.count}
            active={filter.assignees.has(o.value)}
            onClick={() => onChange({ ...filter, assignees: toggle(filter.assignees, o.value) })}
          />
        ))}
      </Group>

      {!isFilterEmpty(filter) && (
        <button
          onClick={reset}
          style={{
            marginLeft: "auto",
            border: "1px solid var(--hairline)",
            background: "transparent",
            color: "var(--ink-soft)",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: "var(--sans)",
            cursor: "pointer",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
