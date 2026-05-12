import type { IssueRecord } from "../linear/types";
import type { WorkflowState } from "../linear/fetchWorkflowStates";

export interface SnapshotFile {
  fetchedAt: string;
  count: number;
  pages: number;
  elapsedMs: number;
  issues: IssueRecord[];
  meta?: {
    workflowStates: WorkflowState[];
  };
}

export async function loadIssues(): Promise<SnapshotFile> {
  const res = await fetch("/data/issues.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`failed to load issues.json: ${res.status}`);
  return (await res.json()) as SnapshotFile;
}
