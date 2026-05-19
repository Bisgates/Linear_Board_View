// Typed wrappers around `@tauri-apps/api/core` `invoke()`. One place to map
// frontend operations to Rust commands — replaces the old `tauriBridge.ts`
// global-fetch shim (which existed only to keep the dual-stack web runtime
// working). Every function here is a thin invoke call with the right argument
// names and return type; no extra logic except the `refetchAndPersist`
// composite (which used to live in the bridge's `/api/refetch` handler).

import { invoke } from "@tauri-apps/api/core";
import type { IssuePatch } from "../linear/updateIssue";
import type { IssueRecord, CommentRecord } from "../linear/types";
import type { WorkflowState } from "../linear/fetchWorkflowStates";
import type { BoardData } from "./workingOn";
import type { SnapshotFile } from "./loadIssues";
import type { ViewsManifest } from "./workingOnViews";

// Runtime detection — still useful for the UI to gate Tauri-only surfaces like
// the in-app updater menu item. Always true in production builds (the app
// only runs inside Tauri now), but the check survives so a stray browser
// preview won't crash.
export function isTauri(): boolean {
  const w = globalThis as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

// --- Snapshot ---
export function readIssuesSnapshot(): Promise<SnapshotFile> {
  return invoke<SnapshotFile>("read_issues_snapshot");
}

// --- Refetch: pull issues + workflow states from Rust GraphQL client, then
//     persist the snapshot. Composite kept here so callers see one function. ---
export interface RefetchResult {
  count: number;
  pages: number;
  elapsedMs: number;
  fetchedAt: string;
  workflowStateCount: number;
}

export async function refetchAndPersist(): Promise<RefetchResult> {
  const start = Date.now();
  const [issuesResult, workflowStates] = await Promise.all([
    invoke<{ issues: IssueRecord[]; pages: number }>("linear_fetch_all_issues"),
    invoke<WorkflowState[]>("linear_fetch_workflow_states"),
  ]);
  const { issues, pages } = issuesResult;
  const elapsedMs = Date.now() - start;
  const fetchedAt = new Date().toISOString();
  const snapshot: SnapshotFile = {
    fetchedAt,
    count: issues.length,
    pages,
    elapsedMs,
    issues,
    meta: { workflowStates },
  };
  await invoke("write_issues_snapshot", { snapshot });
  return {
    count: issues.length,
    pages,
    elapsedMs,
    fetchedAt,
    workflowStateCount: workflowStates.length,
  };
}

// --- Issue mutations ---
export function updateIssue(id: string, patch: IssuePatch): Promise<IssueRecord> {
  return invoke<IssueRecord>("linear_update_issue", { id, patch });
}

export function createIssueComment(issueId: string, body: string): Promise<CommentRecord> {
  return invoke<CommentRecord>("linear_create_issue_comment", { issueId, body });
}

// --- Open path / URL via macOS `open` ---
export function openPath(path: string): Promise<void> {
  return invoke<void>("open_path", { path });
}

// --- iCloud backup — manual trigger. Returns true if a snapshot was written,
// false if iCloud Drive is unavailable. The scheduled backup runs every
// 12:00 / 15:00 / 18:00 / 21:00 / 00:00 local time without UI. ---
export function backupNow(): Promise<boolean> {
  return invoke<boolean>("backup_now");
}

// --- Day (Working On) views ---
export function readDayManifest(): Promise<ViewsManifest> {
  return invoke<ViewsManifest>("read_day_manifest");
}

export function writeDayManifest(manifest: ViewsManifest): Promise<ViewsManifest> {
  return invoke<ViewsManifest>("write_day_manifest", { manifest });
}

export function readDayViewBoard(viewId: string): Promise<BoardData> {
  return invoke<BoardData>("read_day_view_board", { viewId });
}

export function writeDayViewBoard(viewId: string, data: BoardData): Promise<BoardData> {
  return invoke<BoardData>("write_day_view_board", { viewId, data });
}

export function deleteDayViewBoard(viewId: string): Promise<void> {
  return invoke<void>("delete_day_view_board", { viewId });
}

// --- Custom views ---
export function readCustomManifest(): Promise<ViewsManifest> {
  return invoke<ViewsManifest>("read_custom_manifest");
}

export function writeCustomManifest(manifest: ViewsManifest): Promise<ViewsManifest> {
  return invoke<ViewsManifest>("write_custom_manifest", { manifest });
}

export function readCustomViewBoard(viewId: string): Promise<BoardData> {
  return invoke<BoardData>("read_custom_view_board", { viewId });
}

export function writeCustomViewBoard(viewId: string, data: BoardData): Promise<BoardData> {
  return invoke<BoardData>("write_custom_view_board", { viewId, data });
}

export function deleteCustomViewBoard(viewId: string): Promise<void> {
  return invoke<void>("delete_custom_view_board", { viewId });
}

// --- All-issues board ---
export function readAllIssuesBoard(): Promise<BoardData> {
  return invoke<BoardData>("read_all_issues_board");
}

export function writeAllIssuesBoard(data: BoardData): Promise<BoardData> {
  return invoke<BoardData>("write_all_issues_board", { data });
}

// --- Board source — discriminated union used by `useBoardState`. ---
export type BoardSource =
  | { kind: "day-view"; viewId: string }
  | { kind: "custom-view"; viewId: string }
  | { kind: "all-issues" };

export function boardSourceKey(source: BoardSource | null): string {
  if (!source) return "";
  switch (source.kind) {
    case "day-view":
      return `day:${source.viewId}`;
    case "custom-view":
      return `custom:${source.viewId}`;
    case "all-issues":
      return "all-issues";
  }
}

export function loadBoardFor(source: BoardSource): Promise<BoardData> {
  switch (source.kind) {
    case "day-view":
      return readDayViewBoard(source.viewId);
    case "custom-view":
      return readCustomViewBoard(source.viewId);
    case "all-issues":
      return readAllIssuesBoard();
  }
}

export function saveBoardFor(source: BoardSource, data: BoardData): Promise<BoardData> {
  switch (source.kind) {
    case "day-view":
      return writeDayViewBoard(source.viewId, data);
    case "custom-view":
      return writeCustomViewBoard(source.viewId, data);
    case "all-issues":
      return writeAllIssuesBoard(data);
  }
}
