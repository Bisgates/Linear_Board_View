import { useEffect, useMemo, useState } from "react";
import type { IssueRecord } from "../linear/types";
import type { IssuePatch } from "../linear/updateIssue";
import type { WorkflowState } from "../linear/fetchWorkflowStates";
import { projectColor } from "../lib/projectColor";

const PRIORITY_LABEL: Record<number, string> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "med",
  4: "low",
};

const PRIORITY_HEX: Record<number, string> = {
  0: "#8b8170",
  1: "#7b3f44",
  2: "#9a5e3f",
  3: "#3e5f78",
  4: "#386f4c",
};

interface Option<V> {
  value: V;
  label: string;
  hint?: string;
}

interface DetailPanelProps {
  issue: IssueRecord;
  allIssues: IssueRecord[];
  workflowStates: WorkflowState[];
  onClose: () => void;
  onMutate: (id: string, patch: IssuePatch) => Promise<void>;
}

interface OptionLookups {
  states: Map<string, { id: string; name: string; type: string }>;
  projects: Map<string, { id: string; name: string }>;
  cycles: Map<string, { id: string; name: string | null; number: number }>;
  assignees: Map<string, { id: string; name: string }>;
  labels: Map<string, { id: string; name: string; color: string }>;
}

const STATE_TYPE_ORDER: Record<string, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
};

/**
 * Build option lookups scoped to a single team.
 * Linear's workflow states, cycles, and most labels are team-scoped — picking
 * options across teams would surface duplicate names ("Todo" × N) and produce
 * cross-team mutations the API rejects.
 *
 * States and cycles are filtered strictly by team. Labels are filtered by
 * presence on any issue belonging to the same team (best-effort; workspace-wide
 * labels are not separately fetched).
 */
function buildLookups(all: IssueRecord[], teamId: string): OptionLookups {
  const states = new Map<string, { id: string; name: string; type: string }>();
  const projects = new Map<string, { id: string; name: string }>();
  const cycles = new Map<string, { id: string; name: string | null; number: number }>();
  const assignees = new Map<string, { id: string; name: string }>();
  const labels = new Map<string, { id: string; name: string; color: string }>();

  for (const i of all) {
    const sameTeam = i.team.id === teamId;
    if (sameTeam && i.state.id) states.set(i.state.id, i.state);
    if (sameTeam && i.cycle) cycles.set(i.cycle.id, i.cycle);
    if (sameTeam) for (const l of i.labels) labels.set(l.id, l);
    if (i.project) projects.set(i.project.id, i.project);
    if (i.assignee) assignees.set(i.assignee.id, i.assignee);
  }
  return { states, projects, cycles, assignees, labels };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "84px 1fr",
        gap: 12,
        alignItems: "center",
        padding: "8px 0",
        borderTop: "1px solid var(--hairline)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "var(--muted)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function Select<V extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  allowNull,
}: {
  value: V | null;
  options: Option<V>[];
  onChange: (v: V | null) => void;
  placeholder?: string;
  allowNull?: boolean;
}) {
  return (
    <select
      value={value === null ? "__null__" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__null__") onChange(null);
        else {
          const found = options.find((o) => String(o.value) === v);
          if (found) onChange(found.value);
        }
      }}
      style={{
        width: "100%",
        padding: "5px 8px",
        fontSize: 12,
        fontFamily: "var(--sans)",
        background: "var(--paper)",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        color: "var(--ink)",
      }}
    >
      {allowNull && <option value="__null__">{placeholder ?? "— none —"}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DetailPanel({ issue, allIssues, workflowStates, onClose, onMutate }: DetailPanelProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");

  // Reset local buffers when the selected issue changes.
  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description ?? "");
  }, [issue.id, issue.title, issue.description]);

  const lookups = useMemo(() => buildLookups(allIssues, issue.team.id), [allIssues, issue.team.id]);

  // States come from the authoritative workspace workflowStates list (covers
  // states our open-issue snapshot doesn't happen to contain, e.g. "Done").
  // Filter to this issue's team, fall back to lookup-derived if meta missing.
  const stateOptions: Option<string>[] = useMemo(() => {
    const teamStates = workflowStates.filter((s) => s.teamId === issue.team.id);
    const source: { id: string; name: string; type: string; position?: number }[] =
      teamStates.length > 0 ? teamStates : Array.from(lookups.states.values());
    return source
      .slice()
      .sort((a, b) => {
        const oa = STATE_TYPE_ORDER[a.type] ?? 99;
        const ob = STATE_TYPE_ORDER[b.type] ?? 99;
        if (oa !== ob) return oa - ob;
        const pa = "position" in a && a.position !== undefined ? a.position : 0;
        const pb = "position" in b && b.position !== undefined ? b.position : 0;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      })
      .map((s) => ({ value: s.id, label: s.name }));
  }, [workflowStates, issue.team.id, lookups.states]);
  const projectOptions: Option<string>[] = useMemo(
    () =>
      Array.from(lookups.projects.values()).map((p) => ({
        value: p.id,
        label: p.name,
      })),
    [lookups.projects],
  );
  const cycleOptions: Option<string>[] = useMemo(
    () =>
      Array.from(lookups.cycles.values()).map((c) => ({
        value: c.id,
        label: c.name ?? `Cycle ${c.number}`,
      })),
    [lookups.cycles],
  );
  const assigneeOptions: Option<string>[] = useMemo(
    () =>
      Array.from(lookups.assignees.values()).map((a) => ({
        value: a.id,
        label: a.name,
      })),
    [lookups.assignees],
  );

  const commitTitle = () => {
    if (title !== issue.title) onMutate(issue.id, { title });
  };
  const commitDescription = () => {
    if (description !== (issue.description ?? "")) onMutate(issue.id, { description });
  };

  const allLabels = Array.from(lookups.labels.values());
  const currentLabelIds = new Set(issue.labels.map((l) => l.id));

  const toggleLabel = (labelId: string) => {
    const next = new Set(currentLabelIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onMutate(issue.id, { labelIds: Array.from(next) });
  };

  const projColor = projectColor(issue.project?.name);

  return (
    <aside
      style={{
        width: 400,
        height: "100%",
        background: "var(--paper)",
        borderLeft: "1px solid var(--hairline)",
        overflowY: "auto",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px 10px",
          borderBottom: "1px solid var(--hairline)",
          position: "sticky",
          top: 0,
          background: "var(--paper)",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: projColor,
              fontWeight: 600,
            }}
          >
            {issue.project?.name ?? "no project"}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            {issue.identifier}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            border: "1px solid var(--hairline)",
            background: "transparent",
            width: 26,
            height: 26,
            borderRadius: 4,
            cursor: "pointer",
            color: "var(--ink-soft)",
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "16px 20px 24px", flex: 1 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            width: "100%",
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1.3,
            padding: "8px 10px",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 4,
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--hairline)")}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.target)
              (e.target as HTMLInputElement).style.borderColor = "transparent";
          }}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commitDescription();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder="No description"
          rows={6}
          style={{
            width: "100%",
            marginTop: 8,
            fontSize: 13,
            lineHeight: 1.5,
            padding: "8px 10px",
            background: "var(--paper-soft)",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            resize: "vertical",
            outline: "none",
          }}
        />

        <Row label="State">
          <Select
            value={issue.state.id}
            options={stateOptions}
            onChange={(v) => v && onMutate(issue.id, { stateId: v })}
          />
        </Row>

        <Row label="Priority">
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 0].map((p) => (
              <button
                key={p}
                onClick={() => onMutate(issue.id, { priority: p })}
                title={`priority ${PRIORITY_LABEL[p]}`}
                style={{
                  flex: 1,
                  padding: "5px 6px",
                  border: `1px solid ${issue.priority === p ? PRIORITY_HEX[p] : "var(--hairline)"}`,
                  background: issue.priority === p ? `${PRIORITY_HEX[p]}1f` : "transparent",
                  color: issue.priority === p ? "var(--ink)" : "var(--ink-soft)",
                  fontSize: 11,
                  fontWeight: issue.priority === p ? 600 : 500,
                  fontFamily: "var(--sans)",
                  borderRadius: 4,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Assignee">
          <Select
            value={issue.assignee?.id ?? null}
            options={assigneeOptions}
            onChange={(v) => onMutate(issue.id, { assigneeId: v })}
            placeholder="— unassigned —"
            allowNull
          />
        </Row>

        <Row label="Project">
          <Select
            value={issue.project?.id ?? null}
            options={projectOptions}
            onChange={(v) => onMutate(issue.id, { projectId: v })}
            placeholder="— no project —"
            allowNull
          />
        </Row>

        <Row label="Cycle">
          {cycleOptions.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              no cycles in workspace
            </span>
          ) : (
            <Select
              value={issue.cycle?.id ?? null}
              options={cycleOptions}
              onChange={(v) => onMutate(issue.id, { cycleId: v })}
              placeholder="— no cycle —"
              allowNull
            />
          )}
        </Row>

        <Row label="Labels">
          {allLabels.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              no labels in workspace
            </span>
          ) : (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {allLabels.map((l) => {
                const active = currentLabelIds.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${active ? l.color || "var(--ink)" : "var(--hairline)"}`,
                      background: active ? `${l.color || "#8b8170"}1f` : "transparent",
                      color: active ? "var(--ink)" : "var(--ink-soft)",
                      fontSize: 11,
                      fontFamily: "var(--sans)",
                      cursor: "pointer",
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        background: l.color || "#8b8170",
                      }}
                    />
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </Row>

        <Row label="Parent">
          {issue.parentId ? (
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-soft)" }}>
              {allIssues.find((i) => i.id === issue.parentId)?.identifier ?? issue.parentId}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>—</span>
          )}
        </Row>

        <Row label="Children">
          {issue.childrenIds.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>—</span>
          ) : (
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-soft)" }}>
              {issue.childrenIds
                .map((cid) => allIssues.find((i) => i.id === cid)?.identifier ?? cid)
                .join("  ")}
            </span>
          )}
        </Row>
      </div>
    </aside>
  );
}
