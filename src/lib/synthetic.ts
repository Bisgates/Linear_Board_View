import type { IssueRecord } from "../linear/types";

const TARGET = 200;

/**
 * If URL has `?perf=1`, pad the issue list up to TARGET by cloning existing
 * entries with unique synthetic ids. No-op otherwise.
 */
export function maybeSynthesize(issues: IssueRecord[]): IssueRecord[] {
  if (typeof window === "undefined") return issues;
  const params = new URLSearchParams(window.location.search);
  if (params.get("perf") !== "1") return issues;
  if (issues.length >= TARGET) return issues;

  const out: IssueRecord[] = [...issues];
  let i = 0;
  while (out.length < TARGET) {
    const src = issues[i % issues.length]!;
    out.push({
      ...src,
      id: `${src.id}__syn_${i}`,
      identifier: `${src.identifier}-${i}`,
      title: `${src.title} (syn ${i})`,
    });
    i++;
  }
  return out;
}
