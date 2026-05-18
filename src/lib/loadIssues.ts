import type { IssueRecord } from "../linear/types";
import type { WorkflowState } from "../linear/fetchWorkflowStates";
import { readIssuesSnapshot } from "./tauriInvoke";

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
  return readIssuesSnapshot();
}
