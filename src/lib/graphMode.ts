/**
 * Graph-mode helpers for the canvas board.
 *
 * A connected component ("domain") of the board's edge graph is rendered as a
 * GRAPH (instead of the default mindmap tree) when ANY node in the component
 * carries a `graphFlags` entry in BoardData. `computeGraphNodeIds` is the ONE
 * source of truth for that judgment — the context menu, the edge renderer and
 * the F/Shift+F tidy exemption all read from the same memoized result so the
 * board can never end up half-tree / half-graph.
 *
 * Pure functions only — no React, no xyflow — so the connectivity logic can
 * be smoke-tested in isolation (see the inline node test in the arc notes).
 */

import type { BoardData } from "./workingOn";

interface EdgeLike {
  source: string;
  target: string;
}

/**
 * Treat `edges` as an UNDIRECTED graph over `nodeIds` and return every node
 * id that lives in a connected component containing at least one flagged id.
 *
 * - Edges whose endpoints aren't both in `nodeIds` are ignored (defensive —
 *   a stale edge referencing a deleted node must not leak ids into the set).
 * - Flags on ids not present in `nodeIds` are ignored for the same reason.
 */
export function computeGraphNodeIds(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<EdgeLike>,
  graphFlags: Readonly<Record<string, true>> | undefined,
): Set<string> {
  const result = new Set<string>();
  if (!graphFlags) return result;
  const flagged = Object.keys(graphFlags);
  if (flagged.length === 0) return result;

  const present = new Set(nodeIds);

  // Union-find over the present node ids.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const id of present) parent.set(id, id);
  for (const e of edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue;
    const rs = find(e.source);
    const rt = find(e.target);
    if (rs !== rt) parent.set(rs, rt);
  }

  const flaggedRoots = new Set<string>();
  for (const id of flagged) {
    if (present.has(id)) flaggedRoots.add(find(id));
  }
  if (flaggedRoots.size === 0) return result;

  for (const id of present) {
    if (flaggedRoots.has(find(id))) result.add(id);
  }
  return result;
}

/**
 * Drop `graphFlags` entries whose node no longer exists on the board — same
 * orphan-pruning convention positions follow. Returns the input object
 * untouched (reference-equal) when nothing needs pruning, so callers can use
 * it inside a load path without triggering spurious state updates.
 */
export function pruneGraphFlags(data: BoardData): BoardData {
  const flags = data.graphFlags;
  if (!flags) return data;
  const keys = Object.keys(flags);
  if (keys.length === 0) return data;
  const valid = new Set<string>();
  for (const n of data.noteNodes) valid.add(n.id);
  for (const id of Object.keys(data.issueMembers)) valid.add(id);
  const orphans = keys.filter((k) => !valid.has(k));
  if (orphans.length === 0) return data;
  const next: Record<string, true> = {};
  for (const k of keys) {
    if (valid.has(k)) next[k] = true;
  }
  return { ...data, graphFlags: next };
}

// ---------- dynamic shortest handle pair ----------

// ---------- graph edge appearance (TEMPORARY 3-dimension switcher) ----------
// Three independent, orthogonal dimensions for graph edge rendering — path
// shape, stroke color, arrow/line treatment — each user-switchable at
// runtime via the note context menu so the winning combination can be picked
// by eye. Each persists to its own localStorage key. Once the user settles,
// the loser branches + this storage plumbing get deleted and the chosen
// rendering stays hardcoded.

function loadStoredChoice<T extends string>(
  key: string,
  valid: ReadonlySet<string>,
  dflt: T,
): T {
  try {
    const v = localStorage.getItem(key);
    if (v && valid.has(v)) return v as T;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return dflt;
}

function saveStoredChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — choice just won't persist across restarts */
  }
}

// -- dimension 1: path shape --

export type GraphEdgeStyle = "perpendicular" | "straight" | "smoothstep" | "bezier";

export const GRAPH_EDGE_STYLE_KEY = "linear_board_view:graph_edge_style";

export const DEFAULT_GRAPH_EDGE_STYLE: GraphEdgeStyle = "perpendicular";

export const GRAPH_EDGE_STYLES: ReadonlyArray<{ id: GraphEdgeStyle; label: string }> = [
  { id: "perpendicular", label: "Perpendicular" },
  { id: "straight", label: "Straight" },
  { id: "smoothstep", label: "Rounded step" },
  { id: "bezier", label: "Soft bezier" },
];

const VALID_STYLES = new Set<string>(GRAPH_EDGE_STYLES.map((s) => s.id));

export function loadGraphEdgeStyle(): GraphEdgeStyle {
  return loadStoredChoice(GRAPH_EDGE_STYLE_KEY, VALID_STYLES, DEFAULT_GRAPH_EDGE_STYLE);
}

export function saveGraphEdgeStyle(style: GraphEdgeStyle): void {
  saveStoredChoice(GRAPH_EDGE_STYLE_KEY, style);
}

// -- dimension 2: stroke color --

export type GraphEdgeColor = "warm-gray" | "accent-purple" | "ink" | "soft";

export const GRAPH_EDGE_COLOR_KEY = "linear_board_view:graph_edge_color";

export const DEFAULT_GRAPH_EDGE_COLOR: GraphEdgeColor = "warm-gray";

/** `css` is the actual stroke value — existing palette vars only, except the
 *  purple which matches the note-card plum swatch (`NOTE_COLORS`). */
export const GRAPH_EDGE_COLORS: ReadonlyArray<{
  id: GraphEdgeColor;
  label: string;
  css: string;
}> = [
  { id: "warm-gray", label: "Warm gray", css: "var(--edge)" },
  { id: "accent-purple", label: "Purple", css: "#8e6b8e" },
  { id: "ink", label: "Ink", css: "var(--ink)" },
  { id: "soft", label: "Soft", css: "var(--hairline-strong)" },
];

const VALID_COLORS = new Set<string>(GRAPH_EDGE_COLORS.map((c) => c.id));

export function graphEdgeColorCss(color: GraphEdgeColor): string {
  return GRAPH_EDGE_COLORS.find((c) => c.id === color)?.css ?? "var(--edge)";
}

export function loadGraphEdgeColor(): GraphEdgeColor {
  return loadStoredChoice(GRAPH_EDGE_COLOR_KEY, VALID_COLORS, DEFAULT_GRAPH_EDGE_COLOR);
}

export function saveGraphEdgeColor(color: GraphEdgeColor): void {
  saveStoredChoice(GRAPH_EDGE_COLOR_KEY, color);
}

// -- dimension 3: arrow / line treatment --

export type GraphEdgeArrow = "arrow" | "plain" | "dashed-arrow" | "dots";

export const GRAPH_EDGE_ARROW_KEY = "linear_board_view:graph_edge_arrow";

export const DEFAULT_GRAPH_EDGE_ARROW: GraphEdgeArrow = "arrow";

export const GRAPH_EDGE_ARROWS: ReadonlyArray<{ id: GraphEdgeArrow; label: string }> = [
  { id: "arrow", label: "Solid + arrow" },
  { id: "plain", label: "Solid, no arrow" },
  { id: "dashed-arrow", label: "Dashed + arrow" },
  { id: "dots", label: "Dot endpoints" },
];

const VALID_ARROWS = new Set<string>(GRAPH_EDGE_ARROWS.map((a) => a.id));

export function loadGraphEdgeArrow(): GraphEdgeArrow {
  return loadStoredChoice(GRAPH_EDGE_ARROW_KEY, VALID_ARROWS, DEFAULT_GRAPH_EDGE_ARROW);
}

export function saveGraphEdgeArrow(arrow: GraphEdgeArrow): void {
  saveStoredChoice(GRAPH_EDGE_ARROW_KEY, arrow);
}

/** The four side handles every card exposes (NoteCard / IssueCard ids). */
export type HandleSide = "t" | "r" | "b" | "l";

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HandlePair {
  s: HandleSide;
  t: HandleSide;
}

const SIDES: HandleSide[] = ["t", "r", "b", "l"];

function handlePoint(rect: NodeRect, side: HandleSide): { x: number; y: number } {
  switch (side) {
    case "t":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "r":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case "b":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "l":
      return { x: rect.x, y: rect.y + rect.h / 2 };
  }
}

function pairDistance(source: NodeRect, target: NodeRect, pair: HandlePair): number {
  const sp = handlePoint(source, pair.s);
  const tp = handlePoint(target, pair.t);
  return Math.hypot(tp.x - sp.x, tp.y - sp.y);
}

/**
 * Pick the (source, target) handle pair with the smallest Euclidean distance
 * out of the 4×4 combinations, with hysteresis: when `current` is provided,
 * the winner must be shorter than the current pair by at least
 * `hysteresisPx` to displace it — otherwise the current pair is kept. This
 * keeps the connection point from flickering between two near-equal sides
 * while a card is being dragged.
 */
export function pickShortestHandlePair(
  source: NodeRect,
  target: NodeRect,
  current: HandlePair | undefined,
  hysteresisPx: number,
): HandlePair {
  let best: HandlePair = { s: "r", t: "l" };
  let bestD = Infinity;
  for (const s of SIDES) {
    for (const t of SIDES) {
      const d = pairDistance(source, target, { s, t });
      if (d < bestD) {
        bestD = d;
        best = { s, t };
      }
    }
  }
  if (current) {
    const curD = pairDistance(source, target, current);
    if (bestD > curD - hysteresisPx) return current;
  }
  return best;
}
