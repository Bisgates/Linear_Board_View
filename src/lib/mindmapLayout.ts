/**
 * Pure-geometry helpers for the mind-map keyboard interactions on CanvasBoard.
 *
 * Five primitives:
 *  - findNeighbor: arrow-key spatial navigation (±45° cone, nearest by Euclidean).
 *  - computeChildPos: Tab — place a new node to the right of `parentId`. The
 *    insert is intentionally dumb: parent's last child Y + sibling step (or
 *    parent's Y if no children yet). NO collision detection, NO push-down.
 *    The user reaches for the F hotkey to clean up.
 *  - computeSiblingPos: Shift+Tab — place a new node in the same column as
 *    `currentId`, below it. Same dumb insert: no overlap resolution. Picks
 *    "parent" by taking the smallest-id incoming edge's source; returns
 *    `parentId = null` for root nodes (no incoming edges) so the caller knows
 *    to skip adding an edge.
 *  - tidySubtree: Reingold-Tilford layout (via d3-hierarchy) for every
 *    descendant of `rootId`, anchored on the root's current position. Returns
 *    absolute positions to write back. Root itself is kept put.
 *  - tidyAllRoots: tidySubtree on every root (no incoming edge), then stacks
 *    the resulting bounding boxes vertically (sorted by current Y) so the
 *    trees never overlap each other.
 *
 * All functions are React-free / xyflow-free so the algorithm can be reasoned
 * about (and smoke-tested) in isolation.
 */
import { hierarchy, tree as d3tree, type HierarchyNode } from "d3-hierarchy";

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
  /** Vertical step between successive siblings. */
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

function getNode(id: string, nodes: NodeGeo[]): NodeGeo | undefined {
  return nodes.find((n) => n.id === id);
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
 * Intentionally simple: no collision detection, no push-down. If the new card
 * lands on top of something, the user presses F to tidy.
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

  let newY: number;
  if (childNodes.length === 0) {
    newY = parent.y;
  } else {
    const lowest = childNodes.reduce((acc, n) => (n.y > acc.y ? n : acc), childNodes[0]!);
    newY = lowest.y + config.siblingDy;
  }

  return { x: newX, y: newY, shifts: [] };
}

/**
 * Shift+Tab → sibling placement. Inherits parent from `currentId`'s first
 * incoming edge (by edge id, ascending). If currentId has no incoming edges
 * it's treated as a root: a new same-column root is placed below it and
 * parentId is returned as null (caller skips adding an edge).
 *
 * Places the new sibling below ALL existing siblings (max sibling Y +
 * siblingDy), not just below the focused one. This matters because the
 * downstream tidy preserves children order by current Y — placing it below
 * everyone guarantees the new card lands last in the layout.
 *
 * Same dumb-insert philosophy as computeChildPos: no collision push-down.
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

  // Lowest Y among siblings (children of parentId). Includes `current` itself.
  // For a root (parentId === null), there is no parent to enumerate siblings
  // from, so fall back to "below current".
  let lowestY = current.y;
  if (parentId !== null) {
    for (const e of data.edges) {
      if (e.source !== parentId) continue;
      const sib = getNode(e.target, nodes);
      if (!sib) continue;
      if (sib.y > lowestY) lowestY = sib.y;
    }
  }

  const newX = current.x;
  const newY = lowestY + config.siblingDy;

  return { parentId, x: newX, y: newY, shifts: [] };
}

// ---------- mindmap tidy ----------

/**
 * Spacing constants for the F / Shift+F tidy operation. Tuned to feel like
 * a hand-arranged mindmap — generous column gap (~140px between card edges),
 * dynamic sibling row that scales with the tallest measured card in the
 * subtree so multi-line notes never overlap their neighbors.
 *
 *  - hSpacing: horizontal distance from the LEFT edge of a parent column to
 *    the LEFT edge of the next column. ≥ defaultW + breathing room.
 *  - vSpacing: extra vertical breathing room added on top of the tallest
 *    measured card height in the subtree, used as the sibling cell. Two
 *    siblings sit `vSpacing` apart at minimum, with more room if any card
 *    is taller than the default.
 *  - rootGapY: gap between bounding boxes of two adjacent root subtrees in
 *    Shift+F (when stacking all roots vertically).
 */
export interface TidyConfig {
  hSpacing: number;
  vSpacing: number;
  rootGapY: number;
  defaultW: number;
  defaultH: number;
}

export const DEFAULT_TIDY_CONFIG: TidyConfig = {
  hSpacing: 420,
  vSpacing: 60,
  rootGapY: 100,
  defaultW: 280,
  defaultH: 110,
};

/** Position update for a single node id, in absolute flow coordinates. */
export interface TidyMove {
  id: string;
  x: number;
  y: number;
}

interface TreeDatum {
  id: string;
  geo: NodeGeo;
}

/**
 * Walk outgoing edges from `rootId` to build a parent→children adjacency map
 * restricted to the subtree, cycle-safe. Children are sorted by current Y so
 * the resulting layout preserves the user's visual ordering when possible.
 */
function buildChildrenMap(
  rootId: string,
  edges: EdgeLike[],
  nodes: NodeGeo[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids: string[] = [];
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      kids.push(e.target);
      queue.push(e.target);
    }
    // Stable order: sort by the child's CURRENT Y so the tidied result
    // preserves the user's intent (top-most stays top-most).
    kids.sort((a, b) => {
      const na = getNode(a, nodes);
      const nb = getNode(b, nodes);
      return (na?.y ?? 0) - (nb?.y ?? 0);
    });
    out.set(cur, kids);
  }
  return out;
}

/**
 * Find the highest ancestor of `id` (the root of its subtree). A root has no
 * incoming edges. If multiple incoming edges exist, follow the smallest by
 * edge id (matches computeSiblingPos's "primary parent" pick).
 */
export function findRoot(id: string, edges: EdgeLike[]): string {
  const visited = new Set<string>([id]);
  let cur = id;
  for (let i = 0; i < 1000; i++) {
    const incoming = edges
      .filter((e) => e.target === cur)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (incoming.length === 0) return cur;
    const next = incoming[0]!.source;
    if (visited.has(next)) return cur; // cycle guard
    visited.add(next);
    cur = next;
  }
  return cur;
}

/** Every node id with no incoming edge. */
export function findAllRoots(nodes: NodeGeo[], edges: EdgeLike[]): string[] {
  const hasIncoming = new Set<string>();
  for (const e of edges) hasIncoming.add(e.target);
  const roots: string[] = [];
  for (const n of nodes) {
    if (!hasIncoming.has(n.id)) roots.push(n.id);
  }
  return roots;
}

/**
 * Reingold-Tilford layout (via d3-hierarchy) for the subtree rooted at
 * `rootId`, oriented left → right. Returns absolute positions for every
 * node in the subtree, anchored so the root keeps its current x/y.
 *
 * Singleton roots (no children) return an empty array — nothing to move.
 */
export function tidySubtree(
  rootId: string,
  nodes: NodeGeo[],
  edges: EdgeLike[],
  config: TidyConfig = DEFAULT_TIDY_CONFIG,
): TidyMove[] {
  const root = getNode(rootId, nodes);
  if (!root) return [];
  const childrenMap = buildChildrenMap(rootId, edges, nodes);
  const total = Array.from(childrenMap.values()).reduce((s, v) => s + v.length, 0);
  if (total === 0) return []; // root has no descendants; nothing to lay out

  // d3-hierarchy expects a parent→child closure. Build the full datum tree.
  const buildDatum = (id: string): TreeDatum & { children?: TreeDatum[] } => {
    const geo = getNode(id, nodes) ?? { id, x: 0, y: 0, w: config.defaultW, h: config.defaultH };
    const kids = childrenMap.get(id) ?? [];
    if (kids.length === 0) return { id, geo };
    return { id, geo, children: kids.map(buildDatum) };
  };
  const rootDatum = buildDatum(rootId);

  const h = hierarchy<TreeDatum>(rootDatum);

  // d3-hierarchy's tree layout works in (x, y) where x is "across siblings"
  // and y is "depth". We swap on read-out so depth runs horizontally.
  //
  // Sibling spacing strategy: nodeSize[0] = 1, and separation(a, b) returns
  // the desired sibling-axis distance in pixels = (centerToCenter). For two
  // siblings of heights ha, hb, centers should sit (ha + hb)/2 + vSpacing
  // apart so their bboxes leave exactly `vSpacing` of clear gap.
  //
  // Cousins (sub-trees of two different parents) need a touch more breathing
  // room — multiplied by 1.25 — so subtree boundaries stay visually distinct
  // instead of mashing into the next group.
  const layout = d3tree<TreeDatum>()
    .nodeSize([1, config.hSpacing])
    .separation((a, b) => {
      const ha = a.data.geo.h || config.defaultH;
      const hb = b.data.geo.h || config.defaultH;
      const base = (ha + hb) / 2 + config.vSpacing;
      const sameParent = a.parent === b.parent;
      return sameParent ? base : base * 1.25;
    });
  layout(h as HierarchyNode<TreeDatum>);

  // After layout: node.x = sibling-axis position (becomes flow Y),
  //               node.y = depth-axis position (becomes flow X).
  //
  // Important: my separation() returns center-to-center distance in pixels,
  // so d3 places nodes such that their CENTERS sit at the right gap. When we
  // render, xyflow uses the position as TOP-LEFT. So a tall card placed at
  // layout-y=Y and rendered at top=Y would extend (h/2) below where d3
  // intended the bottom — overlapping a shorter neighbor below it.
  //
  // Fix: convert center → top-left on emit by subtracting h/2 (height) and
  // w/2 (width). The anchor `dy` is computed against the root's intended
  // top-left so the root still lands exactly where the user had it.
  const layoutRoot = h as unknown as { x: number; y: number };
  const rootW = root.w || config.defaultW;
  const rootH = root.h || config.defaultH;
  // Solve flow_y_for_root = root.y → root.y = layoutRoot.x - rootH/2 + dy
  //                                        → dy = root.y - layoutRoot.x + rootH/2
  const dx = root.x - layoutRoot.y + rootW / 2;
  const dy = root.y - layoutRoot.x + rootH / 2;

  const moves: TidyMove[] = [];
  h.each((node) => {
    const id = node.data.id;
    const lx = (node as unknown as { x: number }).x;
    const ly = (node as unknown as { y: number }).y;
    const nw = node.data.geo.w || config.defaultW;
    const nh = node.data.geo.h || config.defaultH;
    moves.push({ id, x: ly - nw / 2 + dx, y: lx - nh / 2 + dy });
  });
  return moves;
}

/**
 * Tidy every root subtree on the canvas. Each root is laid out with
 * tidySubtree (anchored on its current x/y), then the resulting bounding
 * boxes are stacked vertically (in current-Y order) with `rootGapY` between
 * boxes — so two trees never overlap each other.
 *
 * The very first root keeps its current Y; subsequent roots shift downward.
 * X anchors are preserved (each tree fans out from where its root sits).
 */
export function tidyAllRoots(
  nodes: NodeGeo[],
  edges: EdgeLike[],
  config: TidyConfig = DEFAULT_TIDY_CONFIG,
): TidyMove[] {
  const roots = findAllRoots(nodes, edges);
  if (roots.length === 0) return [];

  // Sort roots by current Y so the visual stacking matches user expectation.
  const sortedRoots = roots
    .map((id) => ({ id, y: getNode(id, nodes)?.y ?? 0 }))
    .sort((a, b) => a.y - b.y)
    .map((r) => r.id);

  const allMoves: TidyMove[] = [];
  let cursorY: number | null = null;

  for (const rootId of sortedRoots) {
    const root = getNode(rootId, nodes);
    if (!root) continue;
    const subtreeMoves = tidySubtree(rootId, nodes, edges, config);

    // Bare root with no children — still place it at the cursor.
    if (subtreeMoves.length === 0) {
      const placedY: number = cursorY === null ? root.y : cursorY;
      allMoves.push({ id: rootId, x: root.x, y: placedY });
      const h = root.h || config.defaultH;
      cursorY = placedY + h + config.rootGapY;
      continue;
    }

    // Bounding box of this subtree as currently laid out (anchored on root).
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of subtreeMoves) {
      const geo = getNode(m.id, nodes);
      const h = geo?.h ?? config.defaultH;
      if (m.y < minY) minY = m.y;
      if (m.y + h > maxY) maxY = m.y + h;
    }

    // First root: keep where it is. Subsequent roots: translate so that the
    // top of this subtree lands at the running cursor.
    const targetTop: number = cursorY === null ? minY : cursorY;
    const dy: number = targetTop - minY;
    if (dy !== 0) {
      for (const m of subtreeMoves) m.y += dy;
    }
    allMoves.push(...subtreeMoves);
    cursorY = (maxY + dy) + config.rootGapY;
  }
  return allMoves;
}
