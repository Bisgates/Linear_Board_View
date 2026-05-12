import type { IssueRecord } from "../linear/types";

export interface FilterState {
  text: string;
  states: Set<string>; // state.type values
  priorities: Set<number>;
  projects: Set<string>; // project name; "" for null
  assignees: Set<string>; // assignee name; "" for null
}

export const EMPTY_FILTER: FilterState = {
  text: "",
  states: new Set(),
  priorities: new Set(),
  projects: new Set(),
  assignees: new Set(),
};

export interface FilterOptions {
  states: { value: string; label: string; count: number }[];
  priorities: { value: number; label: string; count: number }[];
  projects: { value: string; label: string; count: number }[];
  assignees: { value: string; label: string; count: number }[];
}

const PRIORITY_LABEL: Record<number, string> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "med",
  4: "low",
};

export function deriveOptions(issues: IssueRecord[]): FilterOptions {
  const states = new Map<string, { label: string; count: number }>();
  const priorities = new Map<number, number>();
  const projects = new Map<string, number>();
  const assignees = new Map<string, number>();

  for (const i of issues) {
    const s = states.get(i.state.type) ?? { label: i.state.name, count: 0 };
    s.count++;
    states.set(i.state.type, s);

    priorities.set(i.priority, (priorities.get(i.priority) ?? 0) + 1);

    const p = i.project?.name ?? "";
    projects.set(p, (projects.get(p) ?? 0) + 1);

    const a = i.assignee?.name ?? "";
    assignees.set(a, (assignees.get(a) ?? 0) + 1);
  }

  return {
    states: Array.from(states.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => b.count - a.count),
    priorities: Array.from(priorities.entries())
      .map(([value, count]) => ({
        value,
        label: PRIORITY_LABEL[value] ?? String(value),
        count,
      }))
      .sort((a, b) => a.value - b.value),
    projects: Array.from(projects.entries())
      .map(([value, count]) => ({ value, label: value || "—", count }))
      .sort((a, b) => b.count - a.count),
    assignees: Array.from(assignees.entries())
      .map(([value, count]) => ({ value, label: value || "unassigned", count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function applyFilter(issues: IssueRecord[], f: FilterState): IssueRecord[] {
  const q = f.text.trim().toLowerCase();
  return issues.filter((i) => {
    if (q && !i.title.toLowerCase().includes(q) && !i.identifier.toLowerCase().includes(q)) {
      return false;
    }
    if (f.states.size > 0 && !f.states.has(i.state.type)) return false;
    if (f.priorities.size > 0 && !f.priorities.has(i.priority)) return false;
    if (f.projects.size > 0 && !f.projects.has(i.project?.name ?? "")) return false;
    if (f.assignees.size > 0 && !f.assignees.has(i.assignee?.name ?? "")) return false;
    return true;
  });
}

export function isFilterEmpty(f: FilterState): boolean {
  return (
    !f.text.trim() &&
    f.states.size === 0 &&
    f.priorities.size === 0 &&
    f.projects.size === 0 &&
    f.assignees.size === 0
  );
}
