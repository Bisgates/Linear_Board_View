import { openPath } from "./tauriInvoke";

export interface NoteImage {
  id: string;
  // Data URL (base64) — stored inline in the board JSON.
  src: string;
  w: number;
  h: number;
}

export interface NoteNode {
  id: string;
  body: string;
  x: number;
  y: number;
  color?: string;
  // Three-state todo cycle: undefined/false-on-both = todo; working=true =
  // "working on" (blue indicator); done=true = done (mutually exclusive with
  // working — the click handler always clears the other).
  working?: boolean;
  done?: boolean;
  images?: NoteImage[];
  // Interleaved text segments — `textSegments[i]` renders before `images[i]`,
  // and `textSegments[images.length]` is the trailing text after the last
  // image. Length is always `images.length + 1`. `body` is kept as the joined
  // value for back-compat with code that just needs flattened text.
  textSegments?: string[];
  // Wiki-style cross-reference id. Format `YYMMDDxx` (date + 2 random
  // letters); see `lib/cardId.ts`. Stable across renames / drags so other
  // notes can reference this one with `[[YYMMDDxx]]` and the link survives
  // any internal id churn. Optional only because legacy notes pre-date the
  // field — App boot fills it in via a one-shot migration.
  cardId?: string;
}

/**
 * Note color palette — 8 Morandi tones spaced across the hue wheel so adjacent
 * swatches are clearly distinguishable on warm-cream paper. First entry is the
 * default (matches the original amber accent).
 */
export const NOTE_COLORS = [
  "#7a8b66", // sage (default)
  "#a86810", // amber
  "#a76e6e", // rose
  "#6b85a3", // slate blue
  "#8e6b8e", // plum
  "#b07b50", // terracotta
  "#6c7a7a", // teal-gray
  "#8b8170", // muted
] as const;

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
}

export const EMPTY_BOARD: BoardData = {
  issueMembers: {},
  noteNodes: [],
  edges: [],
  groups: [],
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
