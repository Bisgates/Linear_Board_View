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
