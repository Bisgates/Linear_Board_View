/**
 * Pure-geometry helpers for the mind-map keyboard interactions on CanvasBoard.
 *
 * Five primitives:
 *  - findNeighbor: arrow-key spatial navigation (±45° cone, nearest by Euclidean).
 *  - computeChildPos: Tab — place a new node one step along the parent's tree
 *    direction. The insert is intentionally dumb: parent's last child along the
 *    stack axis + sibling step (or parent's own coord if no children yet). NO
 *    collision detection, NO push-down. The user reaches for the F hotkey to
 *    clean up.
 *  - computeSiblingPos: Shift+Tab — place a new node along the stack axis of
 *    the current card. Same dumb insert: no overlap resolution. Picks "parent"
 *    by taking the smallest-id incoming edge's source; returns
 *    `parentId = null` for root nodes (no incoming edges) so the caller knows
 *    to skip adding an edge.
 *  - tidySubtree: slot-based recursive layout for every descendant of
 *    `rootId`, anchored on the root's current position. Invariants:
 *      (a) every topological LEAF (no outgoing children edges) gets its OWN
 *          stack-axis slot — a shallow leaf is never squeezed next to a
 *          deeper leaf of a sibling's subtree;
 *      (b) every internal/parent node is centered (along the stack axis)
 *          between its first and last direct children.
 *    Returns absolute positions to write back. Root keeps its anchor.
 *  - tidyAllRoots: tidySubtree on every root (no incoming edge), then stacks
 *    the resulting bounding boxes vertically (sorted by current Y) so the
 *    trees never overlap each other.
 *
 * Direction support (v0.34.0):
 *  - Each tree's root can carry a RootDirection (right/left/up/down) — looked
 *    up via the `directions` map passed to each layout function. Missing
 *    entries default to "right", preserving legacy behavior.
 *  - The geometry is parameterized on a (primaryAxis, primarySign) pair so
 *    every helper collapses to one implementation that runs in the chosen
 *    direction's frame and projects back to flow (x, y) coordinates.
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

/** Mindmap growth direction. Default everywhere is "right". */
export type RootDirection = "right" | "left" | "up" | "down";

/** Top-left-to-top-left vertical stride for up/down trees. Exported so
 *  callers (e.g. the canvas slider) can use it as a baseline default. */
export const DEFAULT_VERTICAL_STRIDE = 240;

export interface LayoutConfig {
  /** Gap from parent's leading edge to child's leading edge along the
   *  primary axis (parent → child direction). x-axis only. */
  childDx: number;
  /** Step between successive siblings along the stack axis. */
  siblingDy: number;
  /** Default w/h when a node has no measured size yet. */
  defaultW: number;
  defaultH: number;
  /** Top-left-to-top-left vertical stride for up/down trees. */
  verticalStride?: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  childDx: 320,
  siblingDy: 140,
  defaultW: 280,
  defaultH: 110,
  verticalStride: DEFAULT_VERTICAL_STRIDE,
};

/** Arrow-key navigation direction — reuses RootDirection's vocabulary. */
export type Direction = RootDirection;

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

/**
 * A direction's coordinate frame:
 *  - primary = the axis children grow along (parent → child).
 *  - stack   = the axis siblings stack along.
 *  - primarySign = +1 if children sit at "higher" primary coord than parent
 *                 (right/down), -1 if "lower" (left/up).
 */
interface Frame {
  primary: "x" | "y";
  stack: "x" | "y";
  primarySign: 1 | -1;
}

function frameOf(dir: RootDirection): Frame {
  switch (dir) {
    case "right":
      return { primary: "x", stack: "y", primarySign: 1 };
    case "left":
      return { primary: "x", stack: "y", primarySign: -1 };
    case "down":
      return { primary: "y", stack: "x", primarySign: 1 };
    case "up":
      return { primary: "y", stack: "x", primarySign: -1 };
  }
}

// Overlap-protection clearance: even when the user pulls verticalStride
// very small, a card's leading edge always sits at least this far from
// the adjacent neighbor's far edge.
const MIN_VERT_CLEARANCE = 40;

/**
 * Climb incoming edges from `id` until a node with no incoming edge is found.
 * If multiple incoming edges exist, follow the smallest by edge id (matches
 * computeSiblingPos's "primary parent" pick). Cycle-safe.
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

/**
 * Resolve the growth direction for the tree containing `nodeId`. Climbs to
 * the root and reads from `directions` (defaulting to "right" when the root
 * has no entry — every legacy board hits this branch).
 */
export function getRootDirection(
  nodeId: string,
  edges: EdgeLike[],
  directions: Readonly<Record<string, RootDirection>> | undefined,
): RootDirection {
  const root = findRoot(nodeId, edges);
  const d = directions?.[root];
  return d ?? "right";
}

// ---------- public API ----------

/**
 * Spatial nearest neighbor in the given direction. Candidates must sit in the
 * ±45° cone centered on `dir`; among those, the smallest Euclidean distance
 * (between bbox centers) wins. Returns null if no candidate exists.
 *
 * This is independent of tree direction — it's pure on-screen geometry.
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
 * Tab → child placement. New node sits one primary-axis step away from
 * `parentId` in the tree's direction; if the parent already has children,
 * the new node goes "after the lowest" along the stack axis. Intentionally
 * simple: no collision detection, no push-down. If the new card lands on
 * top of something, the user presses F to tidy.
 */
export function computeChildPos(
  parentId: string,
  data: DataLike,
  nodes: NodeGeo[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  directions?: Readonly<Record<string, RootDirection>>,
): PlacementResult | null {
  const parent = getNode(parentId, nodes);
  if (!parent) return null;

  const dir = getRootDirection(parentId, data.edges, directions);
  const f = frameOf(dir);

  // Existing children of parent (via outgoing edges).
  const childIds: string[] = [];
  for (const e of data.edges) if (e.source === parentId) childIds.push(e.target);
  const childNodes = childIds
    .map((id) => getNode(id, nodes))
    .filter((n): n is NodeGeo => Boolean(n));

  // Primary coord:
  //  - x axis: legacy depth stride (parent + sign * childDx).
  //  - y axis: stride = max(VERTICAL_STRIDE, neighbor h + MIN_VERT_CLEARANCE).
  //    For down, "neighbor" = parent (its bottom must clear). For up,
  //    "neighbor" = new child (its bottom must clear parent's top).
  const parentPrimary = f.primary === "x" ? parent.x : parent.y;
  let newPrimary: number;
  if (f.primary === "x") {
    newPrimary = parentPrimary + f.primarySign * config.childDx;
  } else if (f.primarySign === 1) {
    const parentExt = parent.h ?? config.defaultH;
    const stride = Math.max(
      config.verticalStride ?? DEFAULT_VERTICAL_STRIDE,
      parentExt + MIN_VERT_CLEARANCE,
    );
    newPrimary = parentPrimary + stride;
  } else {
    // new child has no measured size yet — assume default.
    const childExt = config.defaultH;
    const stride = Math.max(
      config.verticalStride ?? DEFAULT_VERTICAL_STRIDE,
      childExt + MIN_VERT_CLEARANCE,
    );
    newPrimary = parentPrimary - stride;
  }

  // Stack coord: parent's stack coord, or step past the last child along
  // the stack axis.
  let newStack: number;
  if (childNodes.length === 0) {
    newStack = f.stack === "x" ? parent.x : parent.y;
  } else {
    // Pick the child farthest along the stack axis (greatest stack coord),
    // then step one siblingDy past it.
    let last = childNodes[0]!;
    let lastStack = f.stack === "x" ? last.x : last.y;
    for (const n of childNodes) {
      const s = f.stack === "x" ? n.x : n.y;
      if (s > lastStack) {
        lastStack = s;
        last = n;
      }
    }
    newStack = lastStack + config.siblingDy;
  }

  const newX = f.primary === "x" ? newPrimary : newStack;
  const newY = f.primary === "y" ? newPrimary : newStack;

  return { x: newX, y: newY, shifts: [] };
}

/**
 * Shift+Tab → sibling placement. Inherits parent from `currentId`'s first
 * incoming edge (by edge id, ascending). If currentId has no incoming edges
 * it's treated as a root: a new same-anchor root is placed one stack step
 * past it, and parentId is returned as null (caller skips adding an edge).
 *
 * Places the new sibling IMMEDIATELY AFTER `currentId` in stack-axis order so
 * the downstream tidy (which sorts siblings by current stack coord) sees the
 * new card between current and the next sibling. If current is already the
 * last sibling, falls back to "one siblingDy past current".
 *
 * Same dumb-insert philosophy as computeChildPos: no collision push-down.
 */
export function computeSiblingPos(
  currentId: string,
  data: DataLike,
  nodes: NodeGeo[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  directions?: Readonly<Record<string, RootDirection>>,
): SiblingResult | null {
  const current = getNode(currentId, nodes);
  if (!current) return null;

  const incoming = data.edges
    .filter((e) => e.target === currentId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const parentId = incoming.length > 0 ? incoming[0]!.source : null;

  // Root's Shift+Tab → keep the legacy "below current, same x column"
  // behavior. A brand-new root inherits no direction (default = right).
  if (parentId === null) {
    const newX = current.x;
    const newY = current.y + config.siblingDy;
    return { parentId: null, x: newX, y: newY, shifts: [] };
  }

  const dir = getRootDirection(currentId, data.edges, directions);
  const f = frameOf(dir);

  // current's stack coord, and the next-sibling stack coord (immediately
  // greater than current's). Used to drop the new card at the midpoint so
  // a sort-by-stack puts it in [current, NEW, nextSib, ...].
  const currentStack = f.stack === "x" ? current.x : current.y;
  let nextSiblingStack: number | null = null;
  for (const e of data.edges) {
    if (e.source !== parentId) continue;
    if (e.target === currentId) continue;
    const sib = getNode(e.target, nodes);
    if (!sib) continue;
    const sibStack = f.stack === "x" ? sib.x : sib.y;
    if (sibStack <= currentStack) continue;
    if (nextSiblingStack === null || sibStack < nextSiblingStack) {
      nextSiblingStack = sibStack;
    }
  }

  const newPrimary = f.primary === "x" ? current.x : current.y;
  const newStack =
    nextSiblingStack !== null
      ? (currentStack + nextSiblingStack) / 2
      : currentStack + config.siblingDy;

  const newX = f.primary === "x" ? newPrimary : newStack;
  const newY = f.primary === "y" ? newPrimary : newStack;

  return { parentId, x: newX, y: newY, shifts: [] };
}

// ---------- mindmap tidy ----------

/**
 * Spacing constants for the F / Shift+F tidy operation. Tuned to feel like
 * a hand-arranged mindmap — generous column gap (~140px between card edges),
 * dynamic sibling row that scales with the tallest measured card in the
 * subtree so multi-line notes never overlap their neighbors.
 *
 *  - hSpacing: distance from the LEADING edge of a parent column to the
 *    LEADING edge of the next column along the primary axis. ≥ defaultW
 *    plus breathing room for horizontal trees; for vertical trees the
 *    same value is used (kept simple — picks one number for both axes).
 *  - vSpacing: extra breathing room added on top of the stack-axis cell
 *    size, used as the sibling cell. Two siblings sit `vSpacing` apart at
 *    minimum, with more room when any card is larger than the default.
 *  - rootGapY: gap between bounding boxes of two adjacent root subtrees in
 *    Shift+F (when stacking all roots vertically).
 */
export interface TidyConfig {
  hSpacing: number;
  vSpacing: number;
  rootGapY: number;
  defaultW: number;
  defaultH: number;
  /** Top-left-to-top-left vertical stride for up/down trees. */
  verticalStride?: number;
}

export const DEFAULT_TIDY_CONFIG: TidyConfig = {
  hSpacing: 420,
  vSpacing: 60,
  rootGapY: 200,
  defaultW: 280,
  defaultH: 110,
  verticalStride: DEFAULT_VERTICAL_STRIDE,
};

/** Position update for a single node id, in absolute flow coordinates. */
export interface TidyMove {
  id: string;
  x: number;
  y: number;
}

/**
 * Walk outgoing edges from `rootId` to build a parent→children adjacency map
 * restricted to the subtree, cycle-safe. Children are sorted by current
 * stack-axis coord so the resulting layout preserves the user's visual
 * ordering when possible.
 *
 * Ordering rule:
 *  - PRIMARY: child's current stack coord (top-most/left-most child sits
 *    first after tidy).
 *  - TIE-BREAKER: edge-array index from `edges`. This matters for newly
 *    inserted siblings (Shift+Tab) whose stack coord hasn't been measured by
 *    ReactFlow yet within the RAF that runs tidy — they would otherwise
 *    sort as +Infinity and land at the END of the sibling row, regardless
 *    of the midpoint the insert helper produced. Insertion order in the
 *    `edges` array thus becomes the authoritative fallback (caller is
 *    expected to splice the new edge in the desired slot, NOT append).
 */
function buildChildrenMap(
  rootId: string,
  edges: EdgeLike[],
  nodes: NodeGeo[],
  stackAxis: "x" | "y",
): Map<string, string[]> {
  const edgeIndex = new Map<string, number>();
  edges.forEach((e, i) => edgeIndex.set(e.id, i));

  const out = new Map<string, string[]>();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids: { id: string; edgeIdx: number }[] = [];
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      kids.push({ id: e.target, edgeIdx: edgeIndex.get(e.id) ?? Number.POSITIVE_INFINITY });
      queue.push(e.target);
    }
    kids.sort((a, b) => {
      const na = getNode(a.id, nodes);
      const nb = getNode(b.id, nodes);
      const sa = (stackAxis === "x" ? na?.x : na?.y) ?? Number.POSITIVE_INFINITY;
      const sb = (stackAxis === "x" ? nb?.x : nb?.y) ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.edgeIdx - b.edgeIdx;
    });
    out.set(cur, kids.map((k) => k.id));
  }
  return out;
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
 * Slot-based recursive layout for the subtree rooted at `rootId`, oriented
 * along the root's direction. Returns absolute positions for every node in
 * the subtree, anchored so the root keeps its current x/y.
 *
 * Algorithm (pure recursion, computed in a local frame where the primary
 * axis is "p" and the stack axis is "s"; the result is projected back to
 * flow coordinates at the end):
 *  - Walk the tree DFS in `buildChildrenMap` order (children sorted by
 *    current stack coord so the user's visual ordering is preserved).
 *  - LEAF: occupies one slot at the running cursor along the stack axis;
 *    advances the cursor by its own stack-extent + vSpacing.
 *  - INTERNAL: recurses into each child in turn; the parent's center sits
 *    at the midpoint of its first and last child's center along the stack
 *    axis. The subtree's "far edge" is max of (cursor after last child) and
 *    (parent's own far edge), so a centered parent can still push the next
 *    sibling subtree along.
 *
 * Singleton roots (no children) return an empty array — nothing to move.
 */
export function tidySubtree(
  rootId: string,
  nodes: NodeGeo[],
  edges: EdgeLike[],
  config: TidyConfig = DEFAULT_TIDY_CONFIG,
  directions?: Readonly<Record<string, RootDirection>>,
): TidyMove[] {
  const root = getNode(rootId, nodes);
  if (!root) return [];

  // The direction for the *tree* this node belongs to — climb to the real
  // root in case Shift+F was pressed on a mid-tree node and `rootId` is
  // actually a descendant of the tree root.
  const treeRoot = findRoot(rootId, edges);
  const dir = directions?.[treeRoot] ?? "right";
  const f = frameOf(dir);

  const childrenMap = buildChildrenMap(rootId, edges, nodes, f.stack);
  const total = Array.from(childrenMap.values()).reduce((s, v) => s + v.length, 0);
  if (total === 0) return []; // root has no descendants; nothing to lay out

  // tempPositions[id] = top-left in a local frame whose origin is the root's
  // top-left. We translate to the root's actual flow position at the end.
  const tempPositions = new Map<string, { x: number; y: number }>();

  interface PlaceResult {
    centerS: number; // center along the stack axis of the node just placed
    subtreeEndS: number; // "far" stack-axis edge of the subtree rooted here
  }

  // Helper to read a node's stack-axis extent (width if stacking on x,
  // height if stacking on y) — falls back to the default size when the
  // node hasn't been measured by ReactFlow yet.
  const stackExtent = (geo: NodeGeo | undefined): number =>
    (f.stack === "x" ? geo?.w : geo?.h) ??
    (f.stack === "x" ? config.defaultW : config.defaultH);
  const primaryExtent = (geo: NodeGeo | undefined): number =>
    (f.primary === "x" ? geo?.w : geo?.h) ??
    (f.primary === "x" ? config.defaultW : config.defaultH);

  // Recurse in the (p, s) local frame.
  //   p (primary axis): for x-axis trees uses the legacy depth stride
  //     (depth * hSpacing * sign). For y-axis trees uses parent-relative
  //     edge-to-edge: parent's trailing edge + PRIMARY_GAP_Y (or mirror).
  //   s (stack axis): running cursor.
  // Local top-left = (p, s); projected to (x, y) at the very end.
  const place = (
    id: string,
    depth: number,
    parentP: number | null,
    parentPExt: number,
    topS: number,
  ): PlaceResult => {
    const geo = getNode(id, nodes);
    const sExt = stackExtent(geo);
    const pExt = primaryExtent(geo);

    let p: number;
    if (parentP === null) {
      p = 0; // root sits at the frame origin
    } else if (f.primary === "x") {
      p = depth * config.hSpacing * f.primarySign;
    } else if (f.primarySign === 1) {
      // down: parent.bottom must clear before child top.
      const stride = Math.max(
        config.verticalStride ?? DEFAULT_VERTICAL_STRIDE,
        parentPExt + MIN_VERT_CLEARANCE,
      );
      p = parentP + stride;
    } else {
      // up: child sits above parent; child's own bottom must clear parent.top.
      const stride = Math.max(
        config.verticalStride ?? DEFAULT_VERTICAL_STRIDE,
        pExt + MIN_VERT_CLEARANCE,
      );
      p = parentP - stride;
    }

    const kids = childrenMap.get(id) ?? [];

    if (kids.length === 0) {
      // Leaf: occupies its own slot at `topS` along the stack axis.
      tempPositions.set(id, projectLocal(p, topS, f));
      return { centerS: topS + sExt / 2, subtreeEndS: topS + sExt };
    }

    // Internal: lay each child subtree out in turn, walking the cursor.
    let cursor = topS;
    let firstChildCenterS: number | null = null;
    let lastChildCenterS = 0;
    for (const kid of kids) {
      const r = place(kid, depth + 1, p, pExt, cursor);
      if (firstChildCenterS === null) firstChildCenterS = r.centerS;
      lastChildCenterS = r.centerS;
      cursor = r.subtreeEndS + config.vSpacing;
    }
    const childrenEndS = cursor - config.vSpacing;
    const parentCenterS = ((firstChildCenterS ?? 0) + lastChildCenterS) / 2;
    // Place the parent so its center along the stack axis equals
    // parentCenterS. Its top-left's stack coord is centerS - sExt/2.
    tempPositions.set(id, projectLocal(p, parentCenterS - sExt / 2, f));

    const subtreeEndS = Math.max(childrenEndS, parentCenterS + sExt / 2);
    return { centerS: parentCenterS, subtreeEndS };
  };

  place(rootId, 0, null, 0, 0);

  // Translate so the root's top-left equals its original (x, y).
  const rootLocal = tempPositions.get(rootId)!;
  const dx = root.x - rootLocal.x;
  const dy = root.y - rootLocal.y;

  const moves: TidyMove[] = [];
  for (const [id, pos] of tempPositions) {
    moves.push({ id, x: pos.x + dx, y: pos.y + dy });
  }
  return moves;
}

/**
 * Project a local-frame top-left (p, s) — where `p` is the primary-axis
 * coord and `s` is the stack-axis coord — back to flow-frame (x, y).
 */
function projectLocal(p: number, s: number, f: Frame): { x: number; y: number } {
  if (f.primary === "x") return { x: p, y: s };
  return { x: s, y: p };
}

/**
 * Tidy every root subtree on the canvas. Each root is laid out with
 * tidySubtree (anchored on its current x/y), then the resulting bounding
 * boxes are stacked vertically (in current-Y order) with `rootGapY` between
 * boxes — so two trees never overlap each other.
 *
 * Root-to-root stacking stays on the Y axis regardless of each tree's own
 * direction (per scope decision — per-tree vertical placement is a separate
 * follow-up). So an Up-tree and a Down-tree may visually extend into each
 * other's bounding-box neighborhood; that's accepted.
 *
 * The very first root keeps its current Y; subsequent roots shift downward.
 * X anchors are preserved (each tree fans out from where its root sits).
 */
export function tidyAllRoots(
  nodes: NodeGeo[],
  edges: EdgeLike[],
  config: TidyConfig = DEFAULT_TIDY_CONFIG,
  directions?: Readonly<Record<string, RootDirection>>,
): TidyMove[] {
  const roots = findAllRoots(nodes, edges);
  if (roots.length === 0) return [];

  const sortedRoots = roots
    .map((id) => ({ id, y: getNode(id, nodes)?.y ?? 0 }))
    .sort((a, b) => a.y - b.y)
    .map((r) => r.id);

  const allMoves: TidyMove[] = [];
  let cursorY: number | null = null;

  for (const rootId of sortedRoots) {
    const root = getNode(rootId, nodes);
    if (!root) continue;
    const subtreeMoves = tidySubtree(rootId, nodes, edges, config, directions);

    if (subtreeMoves.length === 0) {
      const placedY: number = cursorY === null ? root.y : cursorY;
      allMoves.push({ id: rootId, x: root.x, y: placedY });
      const h = root.h || config.defaultH;
      cursorY = placedY + h + config.rootGapY;
      continue;
    }

    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of subtreeMoves) {
      const geo = getNode(m.id, nodes);
      const h = geo?.h ?? config.defaultH;
      if (m.y < minY) minY = m.y;
      if (m.y + h > maxY) maxY = m.y + h;
    }

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
