import { openPath } from "./tauriInvoke";

export interface NoteNode {
  id: string;
  // Markdown — plain text plus `![](<hash>.<ext>)` tokens for embedded
  // images. The image file lives on disk under `<data>/images/<hash>.<ext>`
  // (content-addressed; see `save_image_bytes` in `src-tauri/src/lib.rs`).
  // Legacy notes used a separate `images[]` + `textSegments[]` interleaved
  // pair — `lib/migrateImages.ts` flattens those into this single field on
  // boot.
  body: string;
  x: number;
  y: number;
  color?: string;
  /** Persisted dimensions appear after the first explicit resize. Legacy notes
   * omit both and continue to size from their content. */
  width?: number;
  height?: number;
  // Retained only so old JSON payloads parse without a migration. Status is no
  // longer rendered, copied, or written by current note interactions.
  working?: boolean;
  done?: boolean;
  // Wiki-style cross-reference id. Format `YYMMDDxx` (date + 2 random
  // letters); see `lib/cardId.ts`. Stable across renames / drags so other
  // notes can reference this one with `[[YYMMDDxx]]` and the link survives
  // any internal id churn. Optional only because legacy notes pre-date the
  // field — App boot fills it in via a one-shot migration.
  cardId?: string;
}

/**
 * FigJam's concise pastel fill palette. The first entry is the default for new
 * notes; stored custom colors remain valid even when they are not in this list.
 */
export const NOTE_COLORS = [
  "#BDE3FF", // blue (default)
  "#B7F7C2", // green
  "#FFE299", // yellow
  "#FFC7C2", // pink/red
  "#D9C2FF", // purple
  "#FFC470", // orange
] as const;

export const NOTE_COLOR_LABELS: Record<(typeof NOTE_COLORS)[number], string> = {
  "#BDE3FF": "blue",
  "#B7F7C2": "green",
  "#FFE299": "yellow",
  "#FFC7C2": "pink",
  "#D9C2FF": "purple",
  "#FFC470": "orange",
};

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0];

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

/**
 * Mindmap growth direction for a root node (a node with no incoming edge).
 * Children, layout (F / Shift+F), Tab / Shift+Tab insertion, and the edge
 * stem all mirror this axis. Non-root nodes inherit their tree's direction
 * implicitly via the root they hang off — there's no per-child override.
 * Missing entries default to "right" (legacy behavior, every existing board).
 */
export type RootDirection = "right" | "left" | "up" | "down";

/**
 * A movement-only grouping: when any member is selected, all members get
 * selected (so xyflow drags them together); other behaviors (edit, edge,
 * detail panel) stay independent. Each node id can belong to at most one
 * group — forming a new group with already-grouped members removes them
 * from their prior group.
 */
export interface GroupBox {
  id: string;
  memberIds: string[];
}

/**
 * One canvas board's persisted state: positions for any node id (issue or
 * note), the note nodes themselves, and user-drawn edges (purely visual —
 * not Linear's parent-child links).
 */
export interface BoardData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: NoteNode[];
  edges: BoardEdge[];
  groups: GroupBox[];
  /**
   * Per-root-node growth direction. Only the root of a tree (no incoming
   * edges) is consulted — its whole subtree mirrors the chosen axis. Keys
   * are node ids; missing entries default to "right". Stored as a flat map
   * (rather than a field on NoteNode) so the same shape works uniformly for
   * note roots AND issue roots — issue nodes live in `issueMembers` and
   * carry no per-node object on the board.
   */
  rootDirections?: Record<string, RootDirection>;
  /**
   * Per-node "this connected component is a graph" marker. Key = node id
   * (set via the note card's right-click "Graph" toggle). The flag is
   * per-NODE but its effect is per-DOMAIN: any flagged node turns its whole
   * connected component (computed over `edges` as an undirected graph) into
   * graph rendering — shortest-handle-pair bezier edges, exempt from F /
   * Shift+F tidy. See `lib/graphMode.ts`. Orphan entries (node deleted) are
   * pruned on board load, same convention as positions.
   */
  graphFlags?: Record<string, true>;
}

export const EMPTY_BOARD: BoardData = {
  issueMembers: {},
  noteNodes: [],
  edges: [],
  groups: [],
  rootDirections: {},
  graphFlags: {},
};

// Tiny random id; not crypto, just unique enough within one user's session.
export function shortId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

/** Open a local file path or URL via the Tauri `open_path` command. */
export async function openLocalPath(p: string): Promise<void> {
  try {
    await openPath(p);
  } catch (err) {
    console.error("[open] failed", err);
  }
}

/**
 * Find next empty grid slot for placing a freshly added node, scanning
 * row-by-row across 6 columns. Returns the first slot whose center is
 * outside MIN_DIST of every existing node center.
 */
const GRID_COLS = 6;
const GRID_DX = 320;
const GRID_DY = 180;
const MIN_DIST = 200;

export function findNextSlot(taken: { x: number; y: number }[]): { x: number; y: number } {
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const c = { x: col * GRID_DX, y: row * GRID_DY };
      let ok = true;
      for (const t of taken) {
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) {
          ok = false;
          break;
        }
      }
      if (ok) return c;
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Like findNextSlot but anchored to a centre point (typically the current
 * viewport centre in flow coordinates). Spirals outward through grid cells so
 * fresh cards land inside the user's current view instead of at the board
 * origin.
 */
export function findNextSlotNear(
  center: { x: number; y: number },
  taken: { x: number; y: number }[],
): { x: number; y: number } {
  const cx = Math.round(center.x / GRID_DX) * GRID_DX;
  const cy = Math.round(center.y / GRID_DY) * GRID_DY;
  const isFree = (p: { x: number; y: number }) => {
    for (const t of taken) {
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) return false;
    }
    return true;
  };
  // Centre first, then concentric rings of grid cells outward.
  const start = { x: cx, y: cy };
  if (isFree(start)) return start;
  for (let ring = 1; ring < 60; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // only the ring edge
        const p = { x: cx + dx * GRID_DX, y: cy + dy * GRID_DY };
        if (isFree(p)) return p;
      }
    }
  }
  return start;
}
