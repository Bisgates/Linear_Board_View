/**
 * Pure-geometry helpers for the mind-map keyboard interactions on CanvasBoard.
 *
 * Three primitives:
 *  - findNeighbor: arrow-key spatial navigation (±45° cone, nearest by Euclidean).
 *  - computeChildPos: Tab — place a new node to the right of `parentId`, pushing
 *    down any overlapping subtree.
 *  - computeSiblingPos: Shift+Tab — place a new node in the same column as
 *    `currentId`, below it, pushing down anything in the way. Picks "parent" by
 *    taking the smallest-id incoming edge's source; returns `parentId = null`
 *    for root nodes (no incoming edges) so the caller knows to skip adding an
 *    edge.
 *
 * All functions are React-free / xyflow-free so the algorithm can be reasoned
 * about (and smoke-tested) in isolation.
 */

export interface NodeGeo {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeLike {
  id: string;
  source: string;
  target: string;
}

interface DataLike {
  edges: EdgeLike[];
}

export interface LayoutConfig {
  /** Horizontal gap from parent's top-left x to child's top-left x. */
  childDx: number;
  /** Vertical step between siblings (and the push-down delta on collision). */
  siblingDy: number;
  /** Default w/h when a node has no measured size yet. */
  defaultW: number;
  defaultH: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  childDx: 320,
  siblingDy: 140,
  defaultW: 280,
  defaultH: 110,
};

export type Direction = "up" | "down" | "left" | "right";

interface Shift {
  id: string;
  dy: number;
}

export interface PlacementResult {
  x: number;
  y: number;
  shifts: Shift[];
}

export interface SiblingResult extends PlacementResult {
  parentId: string | null;
}

// ---------- helpers ----------

function center(n: NodeGeo): { cx: number; cy: number } {
  return { cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
}

function aabbOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function getNode(id: string, nodes: NodeGeo[]): NodeGeo | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * BFS over outgoing edges from `rootId`. Excludes the root itself. Cycle-safe
 * via the visited set. The returned set is everything that should move when
 * the root moves.
 */
function collectSubtree(rootId: string, edges: EdgeLike[]): Set<string> {
  const subtree = new Set<string>();
  const queue: string[] = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      subtree.add(e.target);
      queue.push(e.target);
    }
  }
  return subtree;
}

/**
 * Greedy push-down: while the new card's bbox overlaps an existing card (not
 * in `exclude`), push that card AND its whole outgoing-subtree down by
 * siblingDy and try again. Returns the accumulated shifts.
 */
function resolveOverlaps(
  newBox: { x: number; y: number; w: number; h: number },
  nodes: NodeGeo[],
  edges: EdgeLike[],
  exclude: Set<string>,
  siblingDy: number,
): Shift[] {
  const shiftMap = new Map<string, number>();
  // Make a mutable working copy so we can detect chained overlaps.
  const working: NodeGeo[] = nodes.map((n) => ({ ...n }));

  const guard = 200; // cap to avoid pathological loops on bad input
  for (let i = 0; i < guard; i++) {
    let collider: NodeGeo | undefined;
    for (const n of working) {
      if (exclude.has(n.id)) continue;
      if (aabbOverlap(newBox, n)) {
        collider = n;
        break;
      }
    }
    if (!collider) break;
    const toMove = collectSubtree(collider.id, edges);
    toMove.add(collider.id);
    for (const id of toMove) {
      const w = working.find((x) => x.id === id);
      if (!w) continue;
      w.y += siblingDy;
      shiftMap.set(id, (shiftMap.get(id) ?? 0) + siblingDy);
    }
  }

  const shifts: Shift[] = [];
  for (const [id, dy] of shiftMap) shifts.push({ id, dy });
  return shifts;
}

// ---------- public API ----------

/**
 * Spatial nearest neighbor in the given direction. Candidates must sit in the
 * ±45° cone centered on `dir`; among those, the smallest Euclidean distance
 * (between bbox centers) wins. Returns null if no candidate exists.
 */
export function findNeighbor(
  focusId: string,
  dir: Direction,
  nodes: NodeGeo[],
): string | null {
  const focus = getNode(focusId, nodes);
  if (!focus) return null;
  const { cx: fx, cy: fy } = center(focus);

  let bestId: string | null = null;
  let bestD = Infinity;

  for (const n of nodes) {
    if (n.id === focusId) continue;
    const { cx, cy } = center(n);
    const dx = cx - fx;
    const dy = cy - fy;

    let inCone = false;
    switch (dir) {
      case "right":
        inCone = dx > 0 && Math.abs(dy) <= dx;
        break;
      case "left":
        inCone = dx < 0 && Math.abs(dy) <= -dx;
        break;
      case "down":
        inCone = dy > 0 && Math.abs(dx) <= dy;
        break;
      case "up":
        inCone = dy < 0 && Math.abs(dx) <= -dy;
        break;
    }
    if (!inCone) continue;

    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      bestId = n.id;
    }
  }
  return bestId;
}

/**
 * Tab → child placement. New node sits one column to the right of `parentId`;
 * if the parent already has children, the new node goes below the lowest one.
 * Anything overlapping (including its subtree) is pushed down.
 */
export function computeChildPos(
  parentId: string,
  data: DataLike,
  nodes: NodeGeo[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): PlacementResult | null {
  const parent = getNode(parentId, nodes);
  if (!parent) return null;

  // Existing children of parent (via outgoing edges).
  const childIds: string[] = [];
  for (const e of data.edges) if (e.source === parentId) childIds.push(e.target);
  const childNodes = childIds
    .map((id) => getNode(id, nodes))
    .filter((n): n is NodeGeo => Boolean(n));

  const newX = parent.x + config.childDx;
  const newW = config.defaultW;
  const newH = config.defaultH;

  let newY: number;
  if (childNodes.length === 0) {
    newY = parent.y;
  } else {
    const lowest = childNodes.reduce((acc, n) => (n.y > acc.y ? n : acc), childNodes[0]!);
    newY = lowest.y + config.siblingDy;
  }

  const newBox = { x: newX, y: newY, w: newW, h: newH };
  const shifts = resolveOverlaps(newBox, nodes, data.edges, new Set([parentId]), config.siblingDy);
  return { x: newX, y: newY, shifts };
}

/**
 * Shift+Tab → sibling placement. Inherits parent from `currentId`'s first
 * incoming edge (by edge id, ascending). If currentId has no incoming edges
 * it's treated as a root: a new same-column root is placed below it and
 * parentId is returned as null (caller skips adding an edge).
 */
export function computeSiblingPos(
  currentId: string,
  data: DataLike,
  nodes: NodeGeo[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): SiblingResult | null {
  const current = getNode(currentId, nodes);
  if (!current) return null;

  const incoming = data.edges
    .filter((e) => e.target === currentId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const parentId = incoming.length > 0 ? incoming[0]!.source : null;

  const newX = current.x;
  const newY = current.y + config.siblingDy;
  const newW = config.defaultW;
  const newH = config.defaultH;

  const newBox = { x: newX, y: newY, w: newW, h: newH };
  // Exclude both the parent (if any) and the current card from push-down.
  const exclude = new Set<string>([currentId]);
  if (parentId) exclude.add(parentId);
  const shifts = resolveOverlaps(newBox, nodes, data.edges, exclude, config.siblingDy);

  return { parentId, x: newX, y: newY, shifts };
}
