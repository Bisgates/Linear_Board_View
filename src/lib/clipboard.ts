/**
 * In-memory clipboard payload for cross-view ⌘C/⌘V. Lives only in React state
 * (not the system clipboard, not localStorage) — refresh clears it.
 *
 * Positions are stored as offsets from the selection group's geometric centre
 * so paste can re-anchor the whole group on the viewport centre of the target
 * view while preserving relative layout.
 *
 * `direction` is optional — only set on items that were a tree root with a
 * non-default direction in the source view. Paste re-applies it to the new
 * node id so the pasted tree's edges keep their growth axis.
 */
import type { RootDirection } from "./workingOn";

export interface ClipboardItemIssue {
  kind: "issue";
  id: string;
  dx: number;
  dy: number;
  direction?: RootDirection;
}

export interface ClipboardItemNote {
  kind: "note";
  body: string;
  color?: string;
  working?: boolean;
  done?: boolean;
  dx: number;
  dy: number;
  direction?: RootDirection;
}

export type ClipboardItem = ClipboardItemIssue | ClipboardItemNote;

export interface ClipboardEdge {
  /** Index into ClipboardPayload.items. Edges only survive when both endpoints are in the buffer. */
  sourceLocalIdx: number;
  targetLocalIdx: number;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ClipboardPayload {
  items: ClipboardItem[];
  edges: ClipboardEdge[];
  copiedAt: number;
}
