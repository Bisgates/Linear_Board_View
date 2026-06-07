import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ConnectionMode,
  MarkerType,
  ViewportPortal,
  useStore,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type Connection,
  useReactFlow,
} from "@xyflow/react";
import type { IssueRecord } from "../linear/types";
import { IssueCard } from "./IssueCard";
import { AgentIssueCard } from "./AgentIssueCard";
import { NoteCard } from "./NoteCard";
import { LabeledEdge } from "./LabeledEdge";
import { BoardContextMenu, type MenuItem } from "./BoardContextMenu";
import { SHARED_FLOW_PROPS } from "../lib/boardProps";
import type { BoardData, BoardEdge, GroupBox, RootDirection } from "../lib/workingOn";
import { DEFAULT_NOTE_COLOR, NOTE_COLORS, shortId } from "../lib/workingOn";
import { saveImageBytes } from "../lib/tauriInvoke";
import { generateCardId } from "../lib/cardId";
import type { ClipboardEdge, ClipboardItem, ClipboardPayload } from "../lib/clipboard";
import {
  DEFAULT_LAYOUT_CONFIG,
  DEFAULT_TIDY_CONFIG,
  computeChildPos,
  computeSiblingPos,
  findAllRoots,
  findNeighbor,
  findRoot,
  tidyAllRoots,
  tidySubtree,
  type Direction,
  type NodeGeo,
  type TidyMove,
} from "../lib/mindmapLayout";
import {
  computeGraphNodeIds,
  pickShortestHandlePair,
  type HandlePair,
} from "../lib/graphMode";

const NODE_TYPES: NodeTypes = {
  issue: IssueCard as unknown as NodeTypes[string],
  agentIssue: AgentIssueCard as unknown as NodeTypes[string],
  note: NoteCard as unknown as NodeTypes[string],
};

// Mint a cardId for a brand-new note from the given `prev.noteNodes`. Every
// note-creation site MUST call this so the App-level migrateCardIds effect
// stays a true no-op — otherwise undo restores a cardId-less snapshot, the
// migration effect fires, pushes a new state, and the undoStack gets stuck
// (each U just bounces between "no cardId" and "fresh cardId").
function mintCardIdFor(notes: ReadonlyArray<{ cardId?: string }>): string | undefined {
  const taken = new Set<string>();
  for (const n of notes) if (n.cardId) taken.add(n.cardId);
  return generateCardId(new Date(), taken) ?? undefined;
}

// OS-clipboard envelope for card copy/paste. Going through the system
// clipboard (not in-memory React state) is the only source of truth — see
// v0.32.0. The prefix is intentionally namespaced so the V key can tell a
// cards payload from arbitrary text the user happens to have copied.
const CARDS_CLIPBOARD_PREFIX = "linear-board-cards:";

function encodeCardsEnvelope(payload: ClipboardPayload): string {
  const json = JSON.stringify(payload);
  // btoa needs Latin-1; use the encodeURIComponent → unescape dance so
  // multi-byte UTF-8 (Chinese note bodies, emoji) survives the round trip.
  const b64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : json;
  return `${CARDS_CLIPBOARD_PREFIX}${b64}`;
}

function decodeCardsEnvelope(text: string): ClipboardPayload | null {
  if (!text.startsWith(CARDS_CLIPBOARD_PREFIX)) return null;
  const b64 = text.slice(CARDS_CLIPBOARD_PREFIX.length).trim();
  try {
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(b64)))
        : b64;
    const parsed = JSON.parse(json) as ClipboardPayload;
    if (!parsed || !Array.isArray(parsed.items) || !Array.isArray(parsed.edges)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Two-layer soft glow rendered on the prospective drop-target during a
// drag-to-reparent. Colors derive from --warm-red (rgb 168,85,98) so they
// stay on-palette. Replaces the v0.30 2px hard ring — should read as a
// gentle glow, not a hard outline.
// Two-layer outer glow keyed to the target card's accent color: a thin inner
// halo at 0.22 alpha + a soft 16px bloom at 0.38 alpha. Falls back to the
// warm-red for cards without a user-pickable color (e.g. Linear issues).
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [168, 85, 98]; // warm-red
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function dropGlowFor(color: string | null | undefined): string {
  const [r, g, b] = hexToRgb(color ?? "#a85562");
  return `0 0 0 4px rgba(${r}, ${g}, ${b}, 0.22), 0 0 16px 4px rgba(${r}, ${g}, ${b}, 0.38)`;
}
const EDGE_TYPES: EdgeTypes = {
  labeled: LabeledEdge as unknown as EdgeTypes[string],
};

interface CanvasBoardProps {
  /**
   * The set of Linear issues to render as nodes on this board. Each view
   * decides its own selection: Working On shows only explicit members,
   * All Issues shows the full filtered snapshot, etc.
   */
  displayedIssues: IssueRecord[];
  data: BoardData;
  loaded: boolean;
  setData: (updater: BoardData | ((prev: BoardData) => BoardData)) => void;
  undo?: () => boolean;
  redo?: () => boolean;
  onSelectIssue?: (id: string | null) => void;
  selectedIssueId?: string | null;
  /**
   * Auto-layout fallback positions used when a displayed issue has no
   * stored position yet. Typically `computeInitialLayout(displayedIssues)`
   * for all-issues-style boards; omitted for working-on-style boards where
   * every member already has an explicit position.
   */
  initialPositions?: Record<string, { x: number; y: number }>;
  /** Hide the loading overlay text. Each view names its own store differently. */
  loadingLabel?: string;
  /** When set to "agentIssue", IssueCard is swapped for AgentIssueCard. Default "issue". */
  issueNodeType?: "issue" | "agentIssue";
  /** Lightweight toast hook used to surface "N items skipped" notices and the
   *  cardId copy confirmation. Reused for any board-internal toast. */
  onClipboardToast?: (kind: "info" | "success" | "error", msg: string) => void;
  /** Identifier of the underlying view. When it changes, the board re-fits the
   * viewport to the new content (so switching Working On views doesn't strand
   * the user in empty space). */
  viewKey?: string;
}

export interface CanvasBoardHandle {
  /** Current viewport centre in flow coordinates — used by callers (e.g. the
   * issue picker) that need to drop new cards inside the visible region. */
  getViewportCenter(): { x: number; y: number } | null;
}

function buildNodes(
  displayedIssues: IssueRecord[],
  data: BoardData,
  initialPositions: Record<string, { x: number; y: number }> | undefined,
  editingNoteId: string | null,
  focusedCardId: string | null,
  issueNodeType: "issue" | "agentIssue",
): Node[] {
  const nodes: Node[] = [];
  for (const issue of displayedIssues) {
    const pos = data.issueMembers[issue.id] ?? initialPositions?.[issue.id] ?? { x: 0, y: 0 };
    nodes.push({
      id: issue.id,
      type: issueNodeType,
      position: { x: pos.x, y: pos.y },
      data: issue as unknown as Record<string, unknown>,
      draggable: true,
      selected: issue.id === focusedCardId,
    });
  }
  for (const note of data.noteNodes) {
    nodes.push({
      id: note.id,
      type: "note",
      position: { x: note.x, y: note.y },
      data: {
        id: note.id,
        body: note.body,
        color: note.color,
        working: note.working ?? false,
        done: note.done ?? false,
        autoEdit: note.id === editingNoteId,
        cardId: note.cardId,
      } as unknown as Record<string, unknown>,
      draggable: true,
      selected: note.id === focusedCardId,
    });
  }
  return nodes;
}

// Default edge color, used as fallback when no preset is specified
const DEFAULT_EDGE_COLOR = "var(--edge)"; // see --edge in src/index.css

// Graph-mode edges: a freshly computed shortest handle pair must beat the
// currently assigned pair by at least this many pixels before the connection
// point switches sides — prevents flicker while a card is dragged along a
// near-equidistant diagonal.
const GRAPH_HANDLE_HYSTERESIS_PX = 8;

// Snap-to-align: when a node is dragged within SNAP_THRESHOLD of another node's
// left / centre / right (X) or top / middle / bottom (Y) line, the dragged
// node snaps to that line and a guide is rendered until release.
const SNAP_THRESHOLD = 10;
const DEFAULT_CARD_W = 280;
const DEFAULT_CARD_H = 110;

interface Guide {
  axis: "v" | "h";
  pos: number;
  start: number;
  end: number;
}

/**
 * Visual guide for an equal-gap snap. Drawn as two short horizontal (or
 * vertical) bars highlighting the matched distances between three cards.
 */
interface GapGuide {
  axis: "x" | "y";
  pos: number;            // cross-axis coord where the bar sits
  span1: [number, number]; // first matched gap (start, end)
  span2: [number, number]; // second matched gap (start, end)
}

const GAP_STRIPE_TOL = 40; // cross-axis tolerance for "same row / column"

function nodeSize(n: Node): { w: number; h: number } {
  const w = (n as { measured?: { width?: number } }).measured?.width ?? n.width ?? DEFAULT_CARD_W;
  const h = (n as { measured?: { height?: number } }).measured?.height ?? n.height ?? DEFAULT_CARD_H;
  return { w, h };
}

/**
 * Equal-gap snap on the X axis: if two stationary cards A,B sit in roughly the
 * same horizontal stripe as the drag node D, and D can be positioned so that
 * the gap B → D equals the gap A → B (or symmetrically D → A vs A → B), snap
 * and emit a gap guide.
 */
function computeGapSnapX(
  dragId: string,
  dragPos: { x: number; y: number },
  dragW: number,
  dragH: number,
  current: Node[],
): { x: number; gap: GapGuide } | null {
  const dragCY = dragPos.y + dragH / 2;
  const stationary = current.filter((n) => n.id !== dragId);
  let best: { x: number; delta: number; gap: GapGuide } | null = null;

  for (const a of stationary) {
    const { w: aw, h: ah } = nodeSize(a);
    const aCY = a.position.y + ah / 2;
    if (Math.abs(aCY - dragCY) > GAP_STRIPE_TOL) continue;
    const aLeft = a.position.x;
    const aRight = aLeft + aw;

    for (const b of stationary) {
      if (a.id === b.id) continue;
      const { w: bw, h: bh } = nodeSize(b);
      const bCY = b.position.y + bh / 2;
      if (Math.abs(bCY - dragCY) > GAP_STRIPE_TOL) continue;
      const bLeft = b.position.x;
      const bRight = bLeft + bw;
      if (aRight >= bLeft) continue; // require A strictly left of B with no overlap

      const gap = bLeft - aRight;
      if (gap <= 0) continue;

      // 1) A | B | D — D placed to the right of B with the same gap.
      const tRight = bRight + gap;
      const dRight = Math.abs(dragPos.x - tRight);
      if (dRight <= SNAP_THRESHOLD && (!best || dRight < best.delta)) {
        const ymid = Math.round(dragCY);
        best = {
          x: tRight,
          delta: dRight,
          gap: {
            axis: "x",
            pos: ymid,
            span1: [aRight, bLeft],
            span2: [bRight, bRight + gap],
          },
        };
      }
      // 2) D | A | B — D placed to the left of A with the same gap.
      const tLeft = aLeft - gap - dragW;
      const dLeft = Math.abs(dragPos.x - tLeft);
      if (dLeft <= SNAP_THRESHOLD && (!best || dLeft < best.delta)) {
        const ymid = Math.round(dragCY);
        best = {
          x: tLeft,
          delta: dLeft,
          gap: {
            axis: "x",
            pos: ymid,
            span1: [tLeft + dragW, aLeft],
            span2: [aRight, bLeft],
          },
        };
      }
      // 3) A | D | B — D placed between A and B with equal sub-gaps.
      const subGap = (bLeft - aRight - dragW) / 2;
      if (subGap > 0) {
        const tMid = aRight + subGap;
        const dMid = Math.abs(dragPos.x - tMid);
        if (dMid <= SNAP_THRESHOLD && (!best || dMid < best.delta)) {
          const ymid = Math.round(dragCY);
          best = {
            x: tMid,
            delta: dMid,
            gap: {
              axis: "x",
              pos: ymid,
              span1: [aRight, tMid],
              span2: [tMid + dragW, bLeft],
            },
          };
        }
      }
    }
  }
  return best ? { x: best.x, gap: best.gap } : null;
}

function computeGapSnapY(
  dragId: string,
  dragPos: { x: number; y: number },
  dragW: number,
  dragH: number,
  current: Node[],
): { y: number; gap: GapGuide } | null {
  const dragCX = dragPos.x + dragW / 2;
  const stationary = current.filter((n) => n.id !== dragId);
  let best: { y: number; delta: number; gap: GapGuide } | null = null;

  for (const a of stationary) {
    const { w: aw, h: ah } = nodeSize(a);
    const aCX = a.position.x + aw / 2;
    if (Math.abs(aCX - dragCX) > GAP_STRIPE_TOL) continue;
    const aTop = a.position.y;
    const aBottom = aTop + ah;

    for (const b of stationary) {
      if (a.id === b.id) continue;
      const { w: bw, h: bh } = nodeSize(b);
      const bCX = b.position.x + bw / 2;
      if (Math.abs(bCX - dragCX) > GAP_STRIPE_TOL) continue;
      const bTop = b.position.y;
      const bBottom = bTop + bh;
      if (aBottom >= bTop) continue;

      const gap = bTop - aBottom;
      if (gap <= 0) continue;

      const tBelow = bBottom + gap;
      const dBelow = Math.abs(dragPos.y - tBelow);
      if (dBelow <= SNAP_THRESHOLD && (!best || dBelow < best.delta)) {
        const xmid = Math.round(dragCX);
        best = {
          y: tBelow,
          delta: dBelow,
          gap: {
            axis: "y",
            pos: xmid,
            span1: [aBottom, bTop],
            span2: [bBottom, bBottom + gap],
          },
        };
      }
      const tAbove = aTop - gap - dragH;
      const dAbove = Math.abs(dragPos.y - tAbove);
      if (dAbove <= SNAP_THRESHOLD && (!best || dAbove < best.delta)) {
        const xmid = Math.round(dragCX);
        best = {
          y: tAbove,
          delta: dAbove,
          gap: {
            axis: "y",
            pos: xmid,
            span1: [tAbove + dragH, aTop],
            span2: [aBottom, bTop],
          },
        };
      }
      const subGap = (bTop - aBottom - dragH) / 2;
      if (subGap > 0) {
        const tMid = aBottom + subGap;
        const dMid = Math.abs(dragPos.y - tMid);
        if (dMid <= SNAP_THRESHOLD && (!best || dMid < best.delta)) {
          const xmid = Math.round(dragCX);
          best = {
            y: tMid,
            delta: dMid,
            gap: {
              axis: "y",
              pos: xmid,
              span1: [aBottom, tMid],
              span2: [tMid + dragH, bTop],
            },
          };
        }
      }
    }
  }
  return best ? { y: best.y, gap: best.gap } : null;
}

function computeSnap(
  dragId: string,
  dragPos: { x: number; y: number },
  current: Node[],
): { x: number | null; y: number | null; guides: Guide[]; gapGuides: GapGuide[] } {
  const drag = current.find((n) => n.id === dragId);
  if (!drag) return { x: null, y: null, guides: [], gapGuides: [] };
  const { w: dw, h: dh } = nodeSize(drag);

  const dragEdgesX = [
    { type: "left", val: dragPos.x },
    { type: "centerX", val: dragPos.x + dw / 2 },
    { type: "right", val: dragPos.x + dw },
  ] as const;
  const dragEdgesY = [
    { type: "top", val: dragPos.y },
    { type: "centerY", val: dragPos.y + dh / 2 },
    { type: "bottom", val: dragPos.y + dh },
  ] as const;

  type Candidate = {
    dragVal: number;
    lineVal: number;
    other: Node;
    otherStart: number;
    otherEnd: number;
  };
  let bestX: Candidate | null = null;
  let bestY: Candidate | null = null;

  for (const other of current) {
    if (other.id === dragId) continue;
    const { w: ow, h: oh } = nodeSize(other);
    const oLeft = other.position.x;
    const oRight = oLeft + ow;
    const oTop = other.position.y;
    const oBottom = oTop + oh;
    const oCx = oLeft + ow / 2;
    const oCy = oTop + oh / 2;

    const otherXLines = [oLeft, oCx, oRight];
    for (const d of dragEdgesX) {
      for (const ov of otherXLines) {
        const delta = Math.abs(d.val - ov);
        if (
          delta <= SNAP_THRESHOLD &&
          (!bestX || delta < Math.abs(bestX.dragVal - bestX.lineVal))
        ) {
          bestX = {
            dragVal: d.val,
            lineVal: ov,
            other,
            otherStart: oTop,
            otherEnd: oBottom,
          };
        }
      }
    }
    const otherYLines = [oTop, oCy, oBottom];
    for (const d of dragEdgesY) {
      for (const ov of otherYLines) {
        const delta = Math.abs(d.val - ov);
        if (
          delta <= SNAP_THRESHOLD &&
          (!bestY || delta < Math.abs(bestY.dragVal - bestY.lineVal))
        ) {
          bestY = {
            dragVal: d.val,
            lineVal: ov,
            other,
            otherStart: oLeft,
            otherEnd: oRight,
          };
        }
      }
    }
  }

  let snappedX = bestX ? bestX.lineVal - (bestX.dragVal - dragPos.x) : null;
  let snappedY = bestY ? bestY.lineVal - (bestY.dragVal - dragPos.y) : null;

  // Try equal-gap snap on each axis only if there's no edge-snap already.
  const gapGuides: GapGuide[] = [];
  if (snappedX === null) {
    const gapX = computeGapSnapX(dragId, dragPos, dw, dh, current);
    if (gapX) {
      snappedX = gapX.x;
      gapGuides.push(gapX.gap);
    }
  }
  if (snappedY === null) {
    const gapY = computeGapSnapY(dragId, dragPos, dw, dh, current);
    if (gapY) {
      snappedY = gapY.y;
      gapGuides.push(gapY.gap);
    }
  }

  const dragLeft = snappedX ?? dragPos.x;
  const dragTop = snappedY ?? dragPos.y;
  const dragRight = dragLeft + dw;
  const dragBottom = dragTop + dh;

  const guides: Guide[] = [];
  if (bestX) {
    guides.push({
      axis: "v",
      pos: bestX.lineVal,
      start: Math.min(dragTop, bestX.otherStart),
      end: Math.max(dragBottom, bestX.otherEnd),
    });
  }
  if (bestY) {
    guides.push({
      axis: "h",
      pos: bestY.lineVal,
      start: Math.min(dragLeft, bestY.otherStart),
      end: Math.max(dragRight, bestY.otherEnd),
    });
  }
  return { x: snappedX, y: snappedY, guides, gapGuides };
}

// Drag-to-reparent: given a dragged card's (live or final) top-left + size,
// return the top-most other node whose bounding box contains the dragged
// card's center point. Returns null when the center is over empty canvas or
// only over the dragged card itself. Used both for the live hover cue and
// for the drop-time reparent decision.
// Drag-to-reparent hit-test: the dragged card's center must fall inside the
// target's expanded box (120% of bbox, centered) before we treat the target as
// a reparent candidate — slightly bigger than the visible card so users don't
// have to land dead-center to trigger a reparent.
const DROP_HIT_RATIO = 1.2;

function nodeAtCenterOf(
  dragId: string,
  dragPos: { x: number; y: number },
  dragSize: { w: number; h: number },
  excluded: ReadonlySet<string>,
  current: Node[],
): Node | null {
  const cx = dragPos.x + dragSize.w / 2;
  const cy = dragPos.y + dragSize.h / 2;
  for (let i = current.length - 1; i >= 0; i--) {
    const n = current[i]!;
    if (n.id === dragId) continue;
    if (excluded.has(n.id)) continue;
    const { w, h } = nodeSize(n);
    const innerW = w * DROP_HIT_RATIO;
    const innerH = h * DROP_HIT_RATIO;
    const left = n.position.x + (w - innerW) / 2;
    const top = n.position.y + (h - innerH) / 2;
    if (cx >= left && cx <= left + innerW && cy >= top && cy <= top + innerH) {
      return n;
    }
  }
  return null;
}

// Forward-walk the edge graph to enumerate every descendant of `rootId`
// (transitively reachable via edge.source === ancestor). Used to prevent
// cycles when reparenting: dropping A onto a descendant of A would create
// a parent-child loop and crash the tidy / tree-render code paths.
function collectDescendants(rootId: string, edges: ReadonlyArray<BoardEdge>): Set<string> {
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (out.has(e.target)) continue;
      out.add(e.target);
      stack.push(e.target);
    }
  }
  return out;
}

function buildEdges(data: BoardData, editingEdgeId: string | null): Edge[] {
  // Memoize the per-source direction lookup so a board with hundreds of
  // edges sharing one root doesn't climb the incoming chain N times.
  const dirCache = new Map<string, RootDirection>();
  const lookupDir = (sourceId: string): RootDirection => {
    const hit = dirCache.get(sourceId);
    if (hit !== undefined) return hit;
    const root = findRoot(sourceId, data.edges);
    const d = data.rootDirections?.[root] ?? "right";
    dirCache.set(sourceId, d);
    return d;
  };
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: "labeled",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: DEFAULT_EDGE_COLOR,
      width: 16,
      height: 16,
    },
    style: {
      stroke: DEFAULT_EDGE_COLOR,
      strokeWidth: 1.6,
    } as React.CSSProperties,
    data: {
      label: e.label ?? "",
      editing: editingEdgeId === e.id,
      borderRadius: 10,
      direction: lookupDir(e.source),
    } as Record<string, unknown>,
  }));
}

// Shared color palette that floats above the bounding box of selected note
// nodes — same UX for single-select and multi-select (≥1 selected). Lives
// inside `<ReactFlow>` so it sits in the same coordinate origin as the
// renderer: flow→screen via the live store transform keeps the palette at
// constant pixel size regardless of zoom, but pinned to the moving bbox in
// flow space. Active swatch highlights only when every selected card shares
// the same color (mixed selections show no active state).
function NoteSelectionPalette({
  onApply,
}: {
  onApply: (ids: string[], color: string) => void;
}) {
  const transform = useStore((s) => s.transform);
  const allNodes = useStore((s) => s.nodes);

  const sel = useMemo(
    () => allNodes.filter((n) => n.type === "note" && n.selected),
    [allNodes],
  );

  if (sel.length < 1) return null;

  let maxRight = -Infinity;
  let minTop = Infinity;
  const colorSet = new Set<string>();
  for (const n of sel) {
    const measured = (n as { measured?: { width?: number } }).measured;
    const w = (measured?.width ?? (n as { width?: number }).width ?? 280) as number;
    if (n.position.x + w > maxRight) maxRight = n.position.x + w;
    if (n.position.y < minTop) minTop = n.position.y;
    const c = (n.data as { color?: string } | undefined)?.color ?? DEFAULT_NOTE_COLOR;
    colorSet.add(c);
  }
  const activeColor = colorSet.size === 1 ? [...colorSet][0]! : null;

  const [tx, ty, zoom] = transform;
  const screenX = maxRight * zoom + tx;
  const screenY = minTop * zoom + ty;
  const ids = sel.map((n) => n.id);

  return (
    <div
      className="nodrag nopan"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        // Anchor the palette's bottom-right corner just above-right of the
        // bbox top-right corner so it floats clearly outside the selection.
        transform: "translate(-100%, calc(-100% - 8px))",
        display: "flex",
        gap: 4,
        padding: "5px 7px",
        background: "var(--paper)",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(26,24,20,0.12)",
        zIndex: 50,
      }}
    >
      {NOTE_COLORS.map((c) => {
        const active = c === activeColor;
        return (
          <button
            key={c}
            type="button"
            aria-label={`color ${c}`}
            className="nodrag nopan"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onApply(ids, c);
            }}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: c,
              border: active ? "1.5px solid var(--ink)" : "1px solid rgba(26,24,20,0.15)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function BoardInner({
  displayedIssues,
  data,
  loaded,
  setData,
  undo,
  redo,
  onSelectIssue,
  selectedIssueId,
  initialPositions,
  loadingLabel,
  issueNodeType = "issue",
  onClipboardToast,
  viewKey,
  forwardedRef,
}: CanvasBoardProps & { forwardedRef?: React.Ref<CanvasBoardHandle> }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  // Board-level keyboard focus — the card that arrow keys / Space / Tab /
  // Shift+Tab act on. Distinct from `selectedIssueId` (which gates the
  // right-hand DetailPanel): arrow nav moves the halo without opening any
  // panel, and the halo can live on a note (which has no DetailPanel at all).
  const [focusedCardId, setFocusedCardId] = useState<string | null>(selectedIssueId ?? null);
  // Mirror the latest focusedCardId so the global keydown listener (which is
  // installed once and lives across renders) can read it without being torn
  // down and reattached on every focus change.
  const focusedCardIdRef = useRef<string | null>(focusedCardId);
  useEffect(() => {
    focusedCardIdRef.current = focusedCardId;
  }, [focusedCardId]);
  // Same mirror for editingNoteId so Space/Esc can read it from the listener.
  const editingNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingNoteIdRef.current = editingNoteId;
  }, [editingNoteId]);
  // And for the current data snapshot, used by Tab / Shift+Tab to compute
  // placement and apply shifts without forcing the listener effect to rebind
  // on every BoardData change.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  // Paste sets this just before setData; the nodes-rebuild useEffect (which
  // runs synchronously after data updates) consumes it to set selection on
  // the newly-pasted ids. Cleared once consumed. More reliable than a RAF
  // because the rebuild reads pending → applies in the same commit.
  const pendingSelectionRef = useRef<Set<string> | null>(null);
  const [linking, setLinking] = useState<
    { mode: "off" } | { mode: "source" } | { mode: "target"; source: string }
  >({ mode: "off" });
  // Drag-to-reparent: live hover target during a single-card drag. Drives the
  // soft drop-cue glow on the candidate parent. Cleared on drag end (regardless
  // of whether the drop actually reparented).
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Mirror the latest dropTargetId in a ref so onNodesChange can read the
  // "drop landed on X" decision atomically at dragging=false without racing
  // the state batch from the previous tick's hit-test.
  const dropTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    dropTargetIdRef.current = dropTargetId;
  }, [dropTargetId]);
  // Identity of the card currently being dragged. Used to (a) exclude self
  // from drop-target hit testing and (b) detect "drop on own descendant" so
  // we can refuse the reparent without confusing the user.
  const dragNodeIdRef = useRef<string | null>(null);
  // Late-bound handles for tidy + geo helpers — declared further down, so we
  // mirror them through refs to avoid TDZ in onNodesChange's deps array.
  // Filled in below where the originals live.
  const getNodeGeosRef = useRef<(() => NodeGeo[]) | null>(null);
  const applyTidyMovesRef = useRef<((moves: TidyMove[]) => void) | null>(null);
  const reactFlow = useReactFlow();

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getViewportCenter() {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return reactFlow.screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      },
    }),
    [reactFlow],
  );


  // When the underlying view changes (e.g. user picks another Working On view
  // from the dropdown), refit the viewport so they land on content, not empty
  // canvas. Wait for `loaded` so we re-fit after the new data swap, not the
  // tail of the previous view.
  const lastFitKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!loaded) return;
    if (lastFitKey.current === viewKey) return;
    lastFitKey.current = viewKey;
    // Two RAFs: first lets the new nodes paint with their measured sizes,
    // second lets xyflow internals see them before fitView.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          reactFlow.fitView({ padding: 0.2, duration: 0, includeHiddenNodes: false });
        } catch {
          /* fitView can throw if no nodes — ignore */
        }
      });
    });
  }, [viewKey, loaded, reactFlow]);
  const [snapGuides, setSnapGuides] = useState<Guide[]>([]);
  const [gapGuides, setGapGuides] = useState<GapGuide[]>([]);

  const [edges, setEdges] = useState<Edge[]>([]);

  const issuesById = useMemo(() => {
    const m = new Map<string, IssueRecord>();
    for (const i of displayedIssues) m.set(i.id, i);
    return m;
  }, [displayedIssues]);

  // Graph-mode domain membership — THE single selector every consumer reads
  // (context-menu Graph toggle / Direction hiding, graph edge rendering, and
  // the F / Shift+F tidy exemption). Recomputed only when the board's node
  // set, edges or flags change — never on drag ticks.
  const graphNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const n of data.noteNodes) ids.push(n.id);
    for (const id of Object.keys(data.issueMembers)) ids.push(id);
    // Issues displayed without an explicit stored position (e.g. all-issues
    // grid fallback) are still nodes that edges can reference.
    for (const i of displayedIssues) {
      if (!data.issueMembers[i.id]) ids.push(i.id);
    }
    return computeGraphNodeIds(ids, data.edges, data.graphFlags);
  }, [data.noteNodes, data.issueMembers, data.edges, data.graphFlags, displayedIssues]);
  // Ref mirror for the global keydown listener (F / Shift+F) and the RAF
  // tidy callbacks, which must read the latest set without rebinding.
  const graphNodeIdsRef = useRef(graphNodeIds);
  useEffect(() => {
    graphNodeIdsRef.current = graphNodeIds;
  }, [graphNodeIds]);

  // Toggle THIS card's graph flag (domain membership is derived, the flag is
  // per-node). Flows through setData so it lands in undo/redo snapshots and
  // the debounced board save like any other board mutation.
  const toggleGraphFlag = useCallback(
    (id: string) => {
      setData((prev) => {
        const flags: Record<string, true> = { ...(prev.graphFlags ?? {}) };
        if (flags[id]) delete flags[id];
        else flags[id] = true;
        return { ...prev, graphFlags: flags };
      });
    },
    [setData],
  );

  // Rebuild nodes when data shape changes (counts / contents) or when the
  // halo / edit target moves. `selected` and `autoEdit` are baked in by
  // buildNodes so they survive every rebuild — without this, e.g. Cmd+Enter
  // (which clears editingNoteId) would wipe the halo because the rebuild
  // overwrites the per-node `selected` flag. Multi-select (box-select / g
  // group) lives only in `nodes` state, so carry it across the rebuild too —
  // otherwise toggling a group would wipe its own selection mid-action.
  useEffect(() => {
    setNodes((current) => {
      const selectedIds = new Set(current.filter((n) => n.selected).map((n) => n.id));
      const built = buildNodes(displayedIssues, data, initialPositions, editingNoteId, focusedCardId, issueNodeType);
      // Paste hand-off: if the paste handler queued a "select these and only
      // these" set, honor it and skip preserving the old selection.
      const pending = pendingSelectionRef.current;
      if (pending) {
        pendingSelectionRef.current = null;
        return built.map((n) => (pending.has(n.id) ? { ...n, selected: true } : n));
      }
      if (selectedIds.size === 0) return built;
      return built.map((n) => (selectedIds.has(n.id) ? { ...n, selected: true } : n));
    });
  }, [displayedIssues, data, initialPositions, editingNoteId, focusedCardId, issueNodeType]);

  // Rebuild edges from data, preserving the currently-selected edge's
  // selection flag so click-to-select survives the rebuild. Without this
  // round-trip xyflow can't track selection (we don't pass onEdgesChange to
  // pure derived edges) and the Delete key has nothing to act on.
  useEffect(() => {
    setEdges((current) => {
      const selectedIds = new Set(current.filter((e) => e.selected).map((e) => e.id));
      const built = buildEdges(data, editingEdgeId);
      if (selectedIds.size === 0) return built;
      return built.map((e) => (selectedIds.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [data, editingEdgeId]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  // External `selectedIssueId` change → bring focus along (e.g. click in the
  // issue picker selects an issue; mind-map focus should follow). The halo
  // itself is baked into buildNodes by `focusedCardId`, so no separate sync
  // effect is needed.
  useEffect(() => {
    if (selectedIssueId) setFocusedCardId(selectedIssueId);
  }, [selectedIssueId]);

  const commitNote = useCallback(
    (
      id: string,
      patch: {
        body?: string;
        color?: string;
        working?: boolean;
        done?: boolean;
      },
    ) => {
      setData((prev) => ({
        ...prev,
        noteNodes: prev.noteNodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      }));
    },
    [setData],
  );

  // Batch color update for all currently-selected notes — driven by the
  // shared palette that floats above a multi-note selection.
  const commitNotesColor = useCallback(
    (ids: string[], color: string) => {
      const idSet = new Set(ids);
      setData((prev) => ({
        ...prev,
        noteNodes: prev.noteNodes.map((n) =>
          idSet.has(n.id) ? { ...n, color } : n,
        ),
      }));
    },
    [setData],
  );

  const commitEdgeLabel = useCallback(
    (id: string, label: string) => {
      setData((prev) => ({
        ...prev,
        edges: prev.edges.map((e) => (e.id === id ? { ...e, label } : e)),
      }));
    },
    [setData],
  );

  const edgeEditingFinished = useCallback(() => {
    setEditingEdgeId(null);
  }, []);

  const noteEditingFinished = useCallback(() => {
    setEditingNoteId(null);
  }, []);

  // Wiki-link lookup: cardId → xyflow node id, computed from the current
  // board snapshot. Wrapped in useMemo so a reference comparison in the
  // decoratedNodes useMemo below is enough — this only changes when the set
  // of cardIds on the board changes (typical: a fresh note added or one
  // deleted), not on every drag tick.
  const cardIdToNodeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const note of data.noteNodes) {
      if (note.cardId) m.set(note.cardId, note.id);
    }
    return m;
  }, [data.noteNodes]);

  // Stable resolver — declared as a useCallback so the inner reference is
  // only invalidated when the lookup map itself changes.
  const resolveCardLink = useCallback(
    (cardId: string): string | null => cardIdToNodeId.get(cardId) ?? null,
    [cardIdToNodeId],
  );

  // Click-to-jump: pan to the destination card while preserving the user's
  // current zoom — `fitView` was too aggressive (always re-zoomed to fill the
  // viewport, even for short hops). Now we read the live viewport zoom and
  // call `setCenter` with that same zoom, so the camera just pans 400ms to
  // the target's geometric center.
  //
  // Also installs the focus halo + selectedId so the destination card glows
  // and keyboard nav picks up from there. Issue cards open the DetailPanel
  // via `onSelectIssue`; notes just take the halo.
  const jumpToNode = useCallback(
    (nodeId: string) => {
      const node = reactFlow.getNode(nodeId);
      if (!node) return;
      const measured = (node as { measured?: { width?: number; height?: number } }).measured;
      const w = measured?.width ?? node.width ?? DEFAULT_CARD_W;
      const h = measured?.height ?? node.height ?? DEFAULT_CARD_H;
      const cx = node.position.x + w / 2;
      const cy = node.position.y + h / 2;
      const { zoom } = reactFlow.getViewport();
      setFocusedCardId(nodeId);
      if (node.type === "issue") onSelectIssue?.(nodeId);
      try {
        reactFlow.setCenter(cx, cy, { zoom, duration: 400 });
      } catch {
        /* setCenter can throw with a stale viewport; ignore */
      }
    },
    [reactFlow, onSelectIssue],
  );

  // Right-click on a note → copy its `cardId` to the system clipboard +
  // surface a non-blocking toast so the user knows the copy went through.
  const copyCardId = useCallback(
    (cardId: string) => {
      const write = async () => {
        try {
          await navigator.clipboard.writeText(`[[${cardId}]]`);
          onClipboardToast?.("success", `已复制 [[${cardId}]]`);
        } catch (err) {
          console.error("[card-id copy] clipboard write failed", err);
          onClipboardToast?.("error", `复制失败: ${String(err)}`);
        }
      };
      void write();
    },
    [onClipboardToast],
  );

  // Augment note nodes with edit handlers (passed via data; functions are stable enough per render).
  // Paint the two-layer soft drop-cue glow on the prospective reparent target
  // via the xyflow node wrapper's `style` — sits outside the card's own
  // border-radius so it reads as a halo around the card, not a ring on top.
  const decoratedNodes = useMemo(() => {
    return nodes.map((n) => {
      const isDropTarget = dropTargetId !== null && n.id === dropTargetId;
      const targetAccent =
        isDropTarget && n.type === "note"
          ? ((n.data as { color?: string } | undefined)?.color ?? DEFAULT_NOTE_COLOR)
          : null;
      const withStyle = isDropTarget
        ? {
            ...n,
            style: {
              ...(n.style ?? {}),
              boxShadow: dropGlowFor(targetAccent),
              borderRadius: 10,
              transition: "box-shadow 0.15s ease-out",
            },
          }
        : n.style && (n.style as { boxShadow?: string }).boxShadow
          ? (() => {
              const rest = { ...(n.style as Record<string, unknown>) };
              delete rest.boxShadow;
              delete rest.borderRadius;
              delete rest.transition;
              return { ...n, style: rest };
            })()
          : n;
      if (withStyle.type !== "note") return withStyle;
      return {
        ...withStyle,
        data: {
          ...withStyle.data,
          onCommit: (patch: {
            body?: string;
            color?: string;
            working?: boolean;
            done?: boolean;
          }) => commitNote(withStyle.id, patch),
          onEditEnd: noteEditingFinished,
          resolveCardLink,
          onJumpToCardNode: jumpToNode,
        } as unknown as Record<string, unknown>,
      };
    });
  }, [nodes, dropTargetId, commitNote, noteEditingFinished, resolveCardLink, jumpToNode]);

  // Per-edge currently-assigned handle pair, kept across renders so the 8px
  // hysteresis in pickShortestHandlePair has a "current" to compare against.
  // Render-layer only — never written back to BoardData.edges.
  const graphHandlePairsRef = useRef(new Map<string, HandlePair>());

  const decoratedEdges = useMemo(() => {
    // Live node geometry (positions update every drag tick via onNodesChange,
    // so graph edges re-pick their shortest handle pair while dragging).
    const nodeById = new Map<string, Node>();
    for (const n of nodes) nodeById.set(n.id, n);
    const pairs = graphHandlePairsRef.current;
    const liveGraphEdgeIds = new Set<string>();

    const out = edges.map((e) => {
      const isGraph = graphNodeIds.has(e.source) && graphNodeIds.has(e.target);
      let graphOverride: Partial<Edge> = {};
      if (isGraph) {
        const sn = nodeById.get(e.source);
        const tn = nodeById.get(e.target);
        if (sn && tn) {
          liveGraphEdgeIds.add(e.id);
          const { w: sw, h: sh } = nodeSize(sn);
          const { w: tw, h: th } = nodeSize(tn);
          const pair = pickShortestHandlePair(
            { x: sn.position.x, y: sn.position.y, w: sw, h: sh },
            { x: tn.position.x, y: tn.position.y, w: tw, h: th },
            pairs.get(e.id),
            GRAPH_HANDLE_HYSTERESIS_PX,
          );
          pairs.set(e.id, pair);
          graphOverride = { sourceHandle: pair.s, targetHandle: pair.t };
        }
        // Finalized graph look (winner of the candidate bake-off): warm-gray
        // stroke matching the tree edges but slightly thinner (1.4 vs 1.6px),
        // solid line, closed arrowhead. The path shape (perpendicular bezier)
        // lives in LabeledEdge's graph branch.
        graphOverride.style = {
          stroke: DEFAULT_EDGE_COLOR,
          strokeWidth: 1.4,
        } as React.CSSProperties;
      }
      return {
        ...e,
        ...graphOverride,
        data: {
          ...(e.data ?? {}),
          graph: isGraph,
          onCommit: (label: string) => commitEdgeLabel(e.id, label),
          onEditEnd: edgeEditingFinished,
        } as Record<string, unknown>,
      };
    });

    // Drop hysteresis state for edges that left graph mode / were deleted.
    for (const id of [...pairs.keys()]) {
      if (!liveGraphEdgeIds.has(id)) pairs.delete(id);
    }
    return out;
  }, [edges, nodes, graphNodeIds, commitEdgeLabel, edgeEditingFinished]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const groups = dataRef.current.groups;

      setNodes((current) => {
        // Group cohesion — two fans-out, both atomic with this state update so
        // they survive xyflow's same-tick drag-start snapshot:
        //
        //   1. selection cascade: any `select` change on a grouped node
        //      mirrors to co-members (so the visual halo / box-select stays
        //      group-atomic).
        //   2. position cohesion: any `position` change on a grouped node
        //      synthesises matching changes for every co-member with the
        //      same dx/dy. This is the load-bearing part — xyflow snapshots
        //      the "drag set" at pointerdown from its internal store, and a
        //      cascaded `selected=true` won't reach that store before drag
        //      start. By emitting position changes ourselves we make the
        //      whole group move regardless of whether xyflow recognised the
        //      multi-selection in time.
        let nodeChanges: NodeChange[] = changes;
        if (groups.length > 0) {
          const memberToGroup = new Map<string, GroupBox>();
          for (const g of groups) for (const id of g.memberIds) memberToGroup.set(id, g);
          const additions: NodeChange[] = [];

          const handledSelGroups = new Set<string>();
          for (const c of changes) {
            if (c.type !== "select") continue;
            const g = memberToGroup.get(c.id);
            if (!g || handledSelGroups.has(g.id)) continue;
            handledSelGroups.add(g.id);
            for (const mid of g.memberIds) {
              if (mid === c.id) continue;
              additions.push({ type: "select", id: mid, selected: c.selected });
            }
          }

          const positionChangeIds = new Set<string>();
          for (const c of changes) if (c.type === "position") positionChangeIds.add(c.id);
          const handledPosGroups = new Set<string>();
          for (const c of changes) {
            if (c.type !== "position" || !c.position) continue;
            const g = memberToGroup.get(c.id);
            if (!g || handledPosGroups.has(g.id)) continue;
            handledPosGroups.add(g.id);
            const primary = current.find((n) => n.id === c.id);
            if (!primary) continue;
            const dx = c.position.x - primary.position.x;
            const dy = c.position.y - primary.position.y;
            // For dragging=true events, skip zero-deltas; for dragging=false
            // (drag-end) we still want to mirror so co-members get a settle
            // event and their final positions land in data.
            if (dx === 0 && dy === 0 && c.dragging !== false) continue;
            for (const mid of g.memberIds) {
              if (positionChangeIds.has(mid)) continue;
              const co = current.find((n) => n.id === mid);
              if (!co) continue;
              additions.push({
                type: "position",
                id: mid,
                position: { x: co.position.x + dx, y: co.position.y + dy },
                dragging: c.dragging,
              });
            }
          }

          if (additions.length > 0) nodeChanges = [...changes, ...additions];
        }

        // Snap-to-align (edge + equal-gap): rewrite live drag position changes
        // when within SNAP_THRESHOLD of another node's edge / centre line, or
        // when D could equalise the gap between two stationary cards. Emit
        // matching guides until release.
        //
        // Skip snapping during a multi-node drag (group / box-select drag):
        // xyflow fires one position change per dragged node with the same
        // delta. Snapping each independently would break the rigid offsets
        // between members; the user can still drop precisely after release.
        const liveDragCount = nodeChanges.filter(
          (c) => c.type === "position" && c.dragging === true,
        ).length;
        const allowSnap = liveDragCount === 1;
        let liveGuides: Guide[] | null = null;
        let liveGapGuides: GapGuide[] | null = null;
        const adjusted = nodeChanges.map((c) => {
          if (c.type === "position" && c.dragging && c.position && allowSnap) {
            const snap = computeSnap(c.id, c.position, current);
            liveGuides = snap.guides;
            liveGapGuides = snap.gapGuides;
            if (snap.x !== null || snap.y !== null) {
              return {
                ...c,
                position: {
                  x: snap.x ?? c.position.x,
                  y: snap.y ?? c.position.y,
                },
              };
            }
          }
          return c;
        });

        const anyLiveDrag = nodeChanges.some(
          (c) => c.type === "position" && c.dragging === true,
        );
        if (!anyLiveDrag) {
          if (snapGuides.length > 0) setSnapGuides([]);
          if (gapGuides.length > 0) setGapGuides([]);
        } else {
          if (liveGuides) setSnapGuides(liveGuides);
          if (liveGapGuides) setGapGuides(liveGapGuides);
        }

        // Drag-to-reparent hover detection. During an active drag, find the
        // first dragged card whose post-snap center lies inside another
        // (non-dragged) card's bbox — that other card is the potential drop
        // target and gets a visual cue. Exclusion set = every id currently
        // being dragged, so cards in a multi-select group don't see each
        // other as drop targets.
        if (anyLiveDrag) {
          const liveDragIds = new Set<string>();
          for (const c of adjusted) {
            if (c.type === "position" && c.dragging === true) liveDragIds.add(c.id);
          }
          let hovered: string | null = null;
          for (const c of adjusted) {
            if (c.type !== "position" || c.dragging !== true || !c.position) continue;
            const dragNode = current.find((n) => n.id === c.id);
            if (!dragNode) continue;
            const hit = nodeAtCenterOf(c.id, c.position, nodeSize(dragNode), liveDragIds, current);
            if (hit) {
              hovered = hit.id;
              break;
            }
          }
          if (dropTargetIdRef.current !== hovered) setDropTargetId(hovered);
        }

        const next = applyNodeChanges(adjusted, current);

        // Drag-to-reparent — single-card drag only (groups skip both the
        // glow and the reparent so the drop is purely positional). On live
        // drag we hit-test the dragged card's center against every other
        // card's rect and stash the first hit as the prospective drop
        // target; on drag-end we read the same ref to decide whether to
        // actually rewire edges. Recomputing at drag-end (instead of
        // trusting the live state) keeps us correct even when WebKit
        // collapses the final tick.
        const livePositionChanges = adjusted.filter(
          (c): c is Extract<NodeChange, { type: "position" }> =>
            c.type === "position" && c.dragging === true && !!c.position,
        );
        if (livePositionChanges.length === 1) {
          const c = livePositionChanges[0]!;
          if (dragNodeIdRef.current !== c.id) dragNodeIdRef.current = c.id;
          const dragged = current.find((n) => n.id === c.id);
          if (dragged) {
            const { w: dw, h: dh } = nodeSize(dragged);
            const cx = (c.position?.x ?? dragged.position.x) + dw / 2;
            const cy = (c.position?.y ?? dragged.position.y) + dh / 2;
            let hit: string | null = null;
            for (const n of current) {
              if (n.id === c.id) continue;
              const { w, h } = nodeSize(n);
              const left = n.position.x;
              const right = left + w;
              const top = n.position.y;
              const bottom = top + h;
              if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
                hit = n.id;
                break;
              }
            }
            // Functional setState — bail early if unchanged to avoid the
            // re-render churn during a 60Hz drag.
            setDropTargetId((prev) => (prev === hit ? prev : hit));
          }
        }

        const settled = adjusted.filter(
          (c): c is Extract<NodeChange, { type: "position" }> =>
            c.type === "position" && c.dragging === false,
        );
        if (settled.length > 0) {
          // Snapshot the reparent target before clearing it. setData rewrites
          // edges in the same call as positions so undo restores both as one
          // step. `reparented` flips true iff at least one edge actually
          // changed — gates the post-RAF auto-tidy below.
          const reparentTargetId = dropTargetIdRef.current;
          if (reparentTargetId !== null) setDropTargetId(null);
          const settledIds = new Set(settled.map((s) => s.id));
          let reparented = false;

          setData((prev) => {
            const issueMembers = { ...prev.issueMembers };
            const noteNodes = [...prev.noteNodes];
            for (const ch of settled) {
              const id = ch.id;
              const after = next.find((n) => n.id === id);
              if (!after) continue;
              if (after.type === "issue" && issueMembers[id]) {
                issueMembers[id] = { x: after.position.x, y: after.position.y };
              } else if (after.type === "note") {
                const idx = noteNodes.findIndex((n) => n.id === id);
                if (idx >= 0) {
                  noteNodes[idx] = { ...noteNodes[idx]!, x: after.position.x, y: after.position.y };
                }
              }
            }
            // Reparent every settled card under `reparentTargetId` (a node
            // has at most one canvas parent → strip any existing incoming
            // parent edge first, then add target→dragged). Cards that would
            // form a cycle (target is one of their descendants) are skipped.
            // `reparented` flags whether any edge actually changed, so the
            // post-commit RAF auto-tidy only fires for real reparents.
            let edges = prev.edges;
            if (reparentTargetId !== null && settledIds.size > 0) {
              const toReparent: string[] = [];
              for (const draggedId of settledIds) {
                if (draggedId === reparentTargetId) continue;
                const descendants = collectDescendants(draggedId, prev.edges);
                if (descendants.has(reparentTargetId)) continue;
                toReparent.push(draggedId);
              }
              if (toReparent.length > 0) {
                const drop = new Set(toReparent);
                edges = prev.edges.filter((e) => !drop.has(e.target));
                for (const draggedId of toReparent) {
                  edges.push({
                    id: shortId("e"),
                    source: reparentTargetId,
                    target: draggedId,
                  });
                }
                reparented = true;
              }
            }
            if (edges === prev.edges) {
              return { ...prev, issueMembers, noteNodes };
            }
            return { ...prev, issueMembers, noteNodes, edges };
          });

          // Schedule a global tidy one frame later so React commits the new
          // edges + the rebuild effect re-syncs nodes before we read geos.
          // Pure positional drags (no edge mutation, no cycle skip) are NOT
          // tidied — drag-only stays a low-cost movement.
          if (reparented) {
            requestAnimationFrame(() => {
              const geoFn = getNodeGeosRef.current;
              const applyFn = applyTidyMovesRef.current;
              if (!geoFn || !applyFn) return;
              const moves = tidyAllRoots(
                geoFn(),
                dataRef.current.edges,
                DEFAULT_TIDY_CONFIG,
                dataRef.current.rootDirections,
                graphNodeIdsRef.current,
              );
              if (moves.length > 0) applyFn(moves);
            });
          }

          dragNodeIdRef.current = null;
          if (dropTargetIdRef.current !== null) setDropTargetId(null);
        }
        return next;
      });
    },
    [setData, snapGuides.length, gapGuides.length],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      const id = shortId("e");
      const edge: BoardEdge = {
        id,
        source: params.source,
        target: params.target,
      };
      if (params.sourceHandle) edge.sourceHandle = params.sourceHandle;
      if (params.targetHandle) edge.targetHandle = params.targetHandle;
      setData((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
    },
    [setData],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (deleted.length === 0) return;
      const ids = new Set(deleted.map((n) => n.id));
      setData((prev) => {
        const issueMembers = { ...prev.issueMembers };
        for (const id of ids) delete issueMembers[id];
        const groups = prev.groups
          .map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => !ids.has(id)) }))
          .filter((g) => g.memberIds.length >= 2);
        return {
          ...prev,
          issueMembers,
          noteNodes: prev.noteNodes.filter((n) => !ids.has(n.id)),
          edges: prev.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
          groups,
        };
      });
    },
    [setData],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      const ids = new Set(deleted.map((e) => e.id));
      setData((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => !ids.has(e.id)),
      }));
    },
    [setData],
  );

  const onNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      if (linking.mode === "source") {
        setLinking({ mode: "target", source: node.id });
        return;
      }
      if (linking.mode === "target") {
        if (node.id !== linking.source) {
          const id = shortId("e");
          setData((prev) => ({
            ...prev,
            edges: [
              ...prev.edges,
              { id, source: linking.source, target: node.id } satisfies BoardEdge,
            ],
          }));
        }
        // Continuous connect — pair semantics. After wiring this edge, drop
        // back to source mode so the next click starts a brand-new pair
        // (a→b, then c→d, then f→e, ...). Esc / c / empty-pane click exits.
        setLinking({ mode: "source" });
        return;
      }
      setFocusedCardId(node.id);
      if (node.type === "issue") onSelectIssue?.(node.id);
    },
    [linking, setData, onSelectIssue, data],
  );

  // Snapshot xyflow's current measured nodes as plain geo records — fed to
  // the pure mindmap-layout helpers (findNeighbor / computeChildPos /
  // computeSiblingPos). Reads from the live ReactFlow store, not React state,
  // so we always get the latest measured dimensions.
  const getNodeGeos = useCallback((): NodeGeo[] => {
    const rfNodes = reactFlow.getNodes();
    return rfNodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      w:
        (n as { measured?: { width?: number } }).measured?.width ??
        n.width ??
        DEFAULT_LAYOUT_CONFIG.defaultW,
      h:
        (n as { measured?: { height?: number } }).measured?.height ??
        n.height ??
        DEFAULT_LAYOUT_CONFIG.defaultH,
    }));
  }, [reactFlow]);
  useEffect(() => {
    getNodeGeosRef.current = getNodeGeos;
  }, [getNodeGeos]);

  // Imperatively focus a note's textarea by id — wins races with ReactFlow's
  // pane focus refresh and StrictMode mount/cleanup. Used by every code path
  // that flips `editingNoteId` so a textarea is about to appear (Tab, Space,
  // dblclick pane, linking-mode pane click).
  const focusNoteTextarea = useCallback((id: string) => {
    const grab = () => {
      const el = document.querySelector(
        `[data-note-textarea="${id}"]`,
      ) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && document.activeElement !== el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    };
    requestAnimationFrame(() => {
      grab();
      setTimeout(grab, 30);
      setTimeout(grab, 100);
    });
  }, []);

  // Apply the layout helpers' `shifts` array to issueMembers + noteNodes,
  // append the new note + (optional) edge, and emit one combined setData.
  // Used by both Tab (child) and Shift+Tab (sibling).
  //
  // `pivotChildId` — only set by Shift+Tab. When provided, the new parent→N
  // edge is spliced into `edges` IMMEDIATELY AFTER the edge
  // (parentEdgeSource → pivotChildId), instead of appended. This guarantees
  // a deterministic [..., pivot, NEW, nextSibling, ...] sibling order even
  // when ReactFlow hasn't measured the new node yet (so its Y reads as
  // +Infinity in the immediate RAF tidy and the y-sort fallback in
  // buildChildrenMap kicks in).
  const insertCardWithLayout = useCallback(
    (
      placement: { x: number; y: number; shifts: { id: string; dy: number }[] },
      parentEdgeSource: string | null,
      color: string,
      pivotChildId?: string,
    ) => {
      const newId = shortId("n");
      const newEdgeId = shortId("e");
      setData((prev) => {
        const issueMembers = { ...prev.issueMembers };
        for (const sh of placement.shifts) {
          const cur = issueMembers[sh.id];
          if (cur) issueMembers[sh.id] = { x: cur.x, y: cur.y + sh.dy };
        }
        const noteNodes = prev.noteNodes.map((n) => {
          const sh = placement.shifts.find((s) => s.id === n.id);
          return sh ? { ...n, y: n.y + sh.dy } : n;
        });
        noteNodes.push({ id: newId, body: "", x: placement.x, y: placement.y, color, cardId: mintCardIdFor(prev.noteNodes) });
        let edges: BoardEdge[] = prev.edges;
        if (parentEdgeSource !== null) {
          const newEdge: BoardEdge = {
            id: newEdgeId,
            source: parentEdgeSource,
            target: newId,
          };
          if (pivotChildId) {
            // Splice immediately after the pivot's incoming edge from the
            // same parent. If we can't find one (defensive — caller invariant
            // says pivotChildId must already be a child of parentEdgeSource),
            // fall back to append.
            const pivotIdx = prev.edges.findIndex(
              (e) => e.source === parentEdgeSource && e.target === pivotChildId,
            );
            if (pivotIdx >= 0) {
              edges = [
                ...prev.edges.slice(0, pivotIdx + 1),
                newEdge,
                ...prev.edges.slice(pivotIdx + 1),
              ];
            } else {
              edges = [...prev.edges, newEdge];
            }
          } else {
            edges = [...prev.edges, newEdge];
          }
        }
        return { ...prev, issueMembers, noteNodes, edges };
      });
      setFocusedCardId(newId);
      setEditingNoteId(newId);
      focusNoteTextarea(newId);
      // Drop any pre-existing multi-select on the prior focus / nodes
      // (e.g. parent stayed `selected: true` from the previous interaction).
      // The rebuild effect re-adds selection for `focusedCardId === newId`
      // via buildNodes — we just need to clear the stale ones here so the
      // preserve-selected branch of the rebuild doesn't carry them through.
      setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)));
      return newId;
    },
    [setData, focusNoteTextarea],
  );

  // After Tab / Shift+Tab tidy settles, make sure the freshly inserted card
  // lands in the visual comfort zone — the central 50% of the viewport
  // (x: 25%–75%, y: 25%–75%). New cards should never hug the edge or escape
  // off-screen. If the card's center is outside that box, pan (keeping zoom)
  // so it lands at viewport center.
  const ensureNodeVisible = useCallback(
    (id: string, x: number, y: number, w: number, h: number) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const { x: vx, y: vy, zoom } = reactFlow.getViewport();
      const cardCX = (x + w / 2) * zoom + vx;
      const cardCY = (y + h / 2) * zoom + vy;
      const zoneLeft = rect.width * 0.25;
      const zoneRight = rect.width * 0.75;
      const zoneTop = rect.height * 0.25;
      const zoneBottom = rect.height * 0.75;
      const inZone =
        cardCX >= zoneLeft &&
        cardCX <= zoneRight &&
        cardCY >= zoneTop &&
        cardCY <= zoneBottom;
      if (inZone) return;
      try {
        reactFlow.setCenter(x + w / 2, y + h / 2, { zoom, duration: 350 });
      } catch {
        /* setCenter can throw on stale viewport; ignore */
      }
    },
    [reactFlow],
  );

  // Mindmap "tidy" — apply a list of absolute (x, y) targets to the live
  // BoardData. Toggles a CSS class on the wrapper for the duration of the
  // animation so xyflow's per-node transform smoothly interpolates instead
  // of teleporting.
  const tidyTimerRef = useRef<number | null>(null);
  const applyTidyMoves = useCallback(
    (moves: TidyMove[]) => {
      if (moves.length === 0) return;
      const wrapper = wrapperRef.current;
      if (wrapper) wrapper.classList.add("tidy-animating");
      setData((prev) => {
        const issueMembers = { ...prev.issueMembers };
        const noteIndex = new Map<string, number>();
        prev.noteNodes.forEach((n, i) => noteIndex.set(n.id, i));
        const noteNodes = prev.noteNodes.slice();
        for (const mv of moves) {
          const noteIdx = noteIndex.get(mv.id);
          if (noteIdx !== undefined) {
            noteNodes[noteIdx] = { ...noteNodes[noteIdx]!, x: mv.x, y: mv.y };
          } else {
            // Issue: mirror the same write-back path as a manual drag (see
            // onNodesChange) — overwrite if already present, else add. On
            // the all-issues board this turns previously implicit grid
            // positions into explicit ones, which is the correct outcome:
            // tidied positions should persist.
            issueMembers[mv.id] = { x: mv.x, y: mv.y };
          }
        }
        return { ...prev, issueMembers, noteNodes };
      });
      // Strip the animation class once the transition has settled, so manual
      // drags afterwards remain instant (no laggy follow-the-cursor feel).
      if (tidyTimerRef.current !== null) {
        window.clearTimeout(tidyTimerRef.current);
      }
      tidyTimerRef.current = window.setTimeout(() => {
        if (wrapper) wrapper.classList.remove("tidy-animating");
        tidyTimerRef.current = null;
      }, 480);
    },
    [setData],
  );
  useEffect(() => {
    applyTidyMovesRef.current = applyTidyMoves;
  }, [applyTidyMoves]);

  useEffect(
    () => () => {
      if (tidyTimerRef.current !== null) window.clearTimeout(tidyTimerRef.current);
    },
    [],
  );

  // Global hotkeys (board-scope, work whenever no text input is focused):
  //   C         = link/connect mode toggle (continuous — same source fans out
  //               until Esc / C exits)
  //   U         = undo
  //   Shift+U   = redo (undo the undo)
  //   F         = tidy every root subtree on the canvas, stacked vertically
  //   Shift+F   = tidy only the subtree containing the focused card
  //   Esc       = exit link mode OR exit note-edit mode (halo stays put)
  //   ↑↓←→     = spatial-nearest-neighbor card navigation (no DetailPanel)
  //   Space     = note → enter inline edit; issue → open DetailPanel
  //   Tab       = generate child note (Linear issue → note, note → note);
  //               auto-runs global tidy after insert
  //   Shift+Tab = generate sibling note under the same incoming-edge parent;
  //               auto-runs global tidy after insert
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const ARROW_DIR: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const onKey = (evt: KeyboardEvent) => {
      // Note: we deliberately allow Shift through (needed for Shift+Tab,
      // Shift+U redo). metaKey/ctrlKey/altKey still abort so ⌘C/⌘V etc.
      // can do their own thing.
      if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
      const editable = isEditable(evt.target) || isEditable(document.activeElement);

      // Esc cascade: link mode → note-edit → clear selection. preventDefault
      // so WebKit doesn't intercept and exit the app's macOS fullscreen.
      // Bails early if an unrelated text input has focus so its own escape
      // (blur/cancel) keeps working.
      if (evt.key === "Escape") {
        if (linking.mode !== "off") {
          evt.preventDefault();
          setLinking({ mode: "off" });
          return;
        }
        if (editingNoteIdRef.current) {
          evt.preventDefault();
          setEditingNoteId(null);
          // focusedCardId untouched — halo stays on the card we just exited.
          return;
        }
        if (editable) return; // some other input owns the Esc — leave it alone
        // Clear selection: focused-card halo, ReactFlow's per-node `selected`
        // flag, and the App-level DetailPanel selection.
        evt.preventDefault();
        setFocusedCardId(null);
        setNodes((current) =>
          current.map((n) => (n.selected ? { ...n, selected: false } : n)),
        );
        onSelectIssue?.(null);
        return;
      }

      // The rest of the hotkeys never fire when a text input has focus.
      if (editable) return;

      // c — toggle connect / link mode. Continuous: once in target mode, a
      // wired edge keeps the same source so the user can fan out without
      // re-pressing c (see onNodeClick + onPaneClick below). c again exits.
      if (evt.key === "c" || evt.key === "C") {
        evt.preventDefault();
        setLinking((prev) => (prev.mode === "off" ? { mode: "source" } : { mode: "off" }));
        return;
      }
      // g — form or dissolve a movement-only group.
      //   selection == exactly one existing group's full member set → dissolve
      //   selection has ≥2 nodes otherwise → form a new group containing them
      //     (members are pulled out of any prior group; each card max 1 group)
      if (evt.key === "g" || evt.key === "G") {
        const selectedIds = reactFlow
          .getNodes()
          .filter((n) => n.selected)
          .map((n) => n.id);
        if (selectedIds.length < 2) return;
        evt.preventDefault();
        const groups = dataRef.current.groups;
        const selSet = new Set(selectedIds);
        const matchExisting = groups.find(
          (g) =>
            g.memberIds.length === selectedIds.length &&
            g.memberIds.every((id) => selSet.has(id)),
        );
        if (matchExisting) {
          setData((prev) => ({
            ...prev,
            groups: prev.groups.filter((g) => g.id !== matchExisting.id),
          }));
          // Also clear the members' selected flag synchronously into nodes
          // state — otherwise xyflow's internal store still sees them as a
          // multi-selection and the very next drag would translate them all
          // together (since xyflow's native multi-drag doesn't consult our
          // data.groups; it consults its own selection snapshot).
          const dissolvedIds = new Set(matchExisting.memberIds);
          setNodes((current) =>
            current.map((n) => (dissolvedIds.has(n.id) ? { ...n, selected: false } : n)),
          );
        } else {
          const newGroup: GroupBox = { id: shortId("grp"), memberIds: selectedIds };
          setData((prev) => {
            const cleaned = prev.groups
              .map((g) => ({
                ...g,
                memberIds: g.memberIds.filter((id) => !selSet.has(id)),
              }))
              .filter((g) => g.memberIds.length >= 2);
            return { ...prev, groups: [...cleaned, newGroup] };
          });
        }
        return;
      }
      // f — tidy every root subtree on the canvas, stacked vertically (the
      // common case: "just clean everything up").
      // Shift+F — tidy only the focused card's local subtree (the focused
      // card itself becomes the anchor; only IT and its descendants move).
      // Does NOT climb to the global root — that surprised users with deep
      // trees, where pressing it on a leaf would reflow the whole canvas
      // because everything shared one root.
      // Shift+F without a focused card is a no-op + toast hint.
      if (evt.key === "f" || evt.key === "F") {
        evt.preventDefault();
        const geos = getNodeGeos();
        const edges = dataRef.current.edges;
        const focusId = focusedCardIdRef.current;
        console.log(
          `[canvas-board] F key: shift=${evt.shiftKey}, focusId=${focusId ?? "(none)"}, focusedState=${focusedCardId ?? "(none)"}, geos=${geos.length}, edges=${edges.length}`,
        );
        if (evt.shiftKey) {
          if (!focusId) {
            console.log(`[canvas-board] → Shift+F no-op (no focused card; use F for whole canvas)`);
            onClipboardToast?.("info", "请先选中一张卡片，再按 Shift+F 整理它所在的子树（或 F 整理全画布）");
            return;
          }
          // Graph-domain exemption: tree tidy is meaningless (and wrong) for
          // a graph — no-op when the focused card lives in a graph domain.
          if (graphNodeIdsRef.current.has(focusId)) {
            console.log(`[canvas-board] → Shift+F no-op (${focusId} is in a graph domain)`);
            return;
          }
          const moves = tidySubtree(
            focusId,
            geos,
            edges,
            DEFAULT_TIDY_CONFIG,
            dataRef.current.rootDirections,
          );
          if (moves.length > 0) applyTidyMoves(moves);
          console.log(`[canvas-board] → tidy SUBTREE from ${focusId}: ${moves.length} moves (this card stays pinned, descendants reflow)`);
        } else {
          // Graph domains are excluded wholesale: their cards neither move
          // nor act as obstacles for the vertical root stacking.
          const moves = tidyAllRoots(
            geos,
            edges,
            DEFAULT_TIDY_CONFIG,
            dataRef.current.rootDirections,
            graphNodeIdsRef.current,
          );
          if (moves.length > 0) applyTidyMoves(moves);
          console.log(`[canvas-board] → tidy ALL: ${moves.length} moves over ${findAllRoots(geos, edges).length} roots (graph-domain cards excluded: ${graphNodeIdsRef.current.size})`);
        }
        return;
      }
      // u — undo;  shift+u — redo (undo the undo).
      if (evt.key === "u" || evt.key === "U") {
        evt.preventDefault();
        if (evt.shiftKey) {
          const ok = redo?.() ?? false;
          console.log(`[canvas-board] redo via shift+U → ${ok ? "ok" : "nothing to redo"}`);
        } else {
          const ok = undo?.() ?? false;
          console.log(`[canvas-board] undo via U key → ${ok ? "ok" : "nothing to undo"}`);
        }
        return;
      }

      // Arrow-key navigation — no preventDefault unless a target was found,
      // so unhandled arrows still bubble (e.g. before the user clicks anything).
      // Clears every other ReactFlow selection first so any prior box-select /
      // multi-select doesn't survive (otherwise the rebuild's preserve-selected
      // branch would carry old halos forward and you'd end up with many cards
      // glowing at once).
      const dir = ARROW_DIR[evt.key];
      if (dir) {
        const focusId = focusedCardIdRef.current;
        if (!focusId) return;
        const geos = getNodeGeos();
        const next = findNeighbor(focusId, dir, geos);
        if (next) {
          evt.preventDefault();
          setNodes((current) =>
            current.map((n) =>
              n.selected && n.id !== next ? { ...n, selected: false } : n,
            ),
          );
          setFocusedCardId(next);
          // Pan the new focus into the visual comfort zone — same helper Tab
          // uses for fresh cards, so even an already-on-screen but edge-hugging
          // neighbor recenters into the central 50% of the viewport.
          const geo = geos.find((g) => g.id === next);
          if (geo) ensureNodeVisible(next, geo.x, geo.y, geo.w, geo.h);
        }
        return;
      }

      // Space — Note: editingNoteIdRef.current check is mostly defensive;
      // when the textarea is open the listener has already bailed via the
      // `editable` guard above.
      //
      // No halo yet (focusId == null): the first Space press picks the card
      // closest to the canvas pane's visual center, drops a halo on it, and
      // pans it into the comfort zone. It does NOT open DetailPanel / enter
      // edit mode — that's reserved for the next Space press.
      if (evt.key === " " || evt.code === "Space") {
        if (editingNoteIdRef.current) return;
        const focusId = focusedCardIdRef.current;
        if (!focusId) {
          const wrapper = wrapperRef.current;
          if (!wrapper) return;
          const geos = getNodeGeos();
          if (geos.length === 0) return;
          const rect = wrapper.getBoundingClientRect();
          const centerScreen = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          const center = reactFlow.screenToFlowPosition(centerScreen);
          let best: NodeGeo | null = null;
          let bestD = Infinity;
          for (const g of geos) {
            const cx = g.x + g.w / 2;
            const cy = g.y + g.h / 2;
            const dx = cx - center.x;
            const dy = cy - center.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = g;
            }
          }
          if (!best) return;
          evt.preventDefault();
          const id = best.id;
          setNodes((current) =>
            current.map((n) => {
              if (n.id === id) return n.selected ? n : { ...n, selected: true };
              return n.selected ? { ...n, selected: false } : n;
            }),
          );
          setFocusedCardId(id);
          ensureNodeVisible(id, best.x, best.y, best.w, best.h);
          return;
        }
        const isNote = dataRef.current.noteNodes.some((n) => n.id === focusId);
        evt.preventDefault();
        if (isNote) {
          setEditingNoteId(focusId);
          focusNoteTextarea(focusId);
        } else {
          // Issue → fall back to DetailPanel as the editor.
          onSelectIssue?.(focusId);
        }
        return;
      }

      // Tab / Shift+Tab — generate child / sibling note. preventDefault is
      // mandatory: otherwise the browser shifts keyboard focus out of the canvas.
      // After insertion, schedule a global tidy (matches the F hotkey) so the
      // new card lands in its mindmap-layout spot — the parent-local placement
      // from computeChildPos/SiblingPos is just an interim anchor.
      if (evt.key === "Tab") {
        const focusId = focusedCardIdRef.current;
        if (!focusId) return;
        evt.preventDefault();
        const geos = getNodeGeos();
        let newId: string | null = null;
        let placement: { x: number; y: number } | null = null;
        if (evt.shiftKey) {
          const p = computeSiblingPos(
            focusId,
            dataRef.current,
            geos,
            DEFAULT_LAYOUT_CONFIG,
            dataRef.current.rootDirections,
          );
          if (!p) return;
          placement = { x: p.x, y: p.y };
          const currentNote = dataRef.current.noteNodes.find((n) => n.id === focusId);
          const color = currentNote?.color ?? DEFAULT_NOTE_COLOR;
          // Pass focusId as the pivot so the new parent→N edge gets spliced
          // immediately after the parent→focus edge — keeps siblings in
          // [..., focus, N, nextSib, ...] order even before ReactFlow has
          // measured the new card.
          newId = insertCardWithLayout(p, p.parentId, color, focusId);
        } else {
          const p = computeChildPos(
            focusId,
            dataRef.current,
            geos,
            DEFAULT_LAYOUT_CONFIG,
            dataRef.current.rootDirections,
          );
          if (!p) return;
          placement = { x: p.x, y: p.y };
          const parentNote = dataRef.current.noteNodes.find((n) => n.id === focusId);
          const color = parentNote?.color ?? DEFAULT_NOTE_COLOR;
          newId = insertCardWithLayout(p, focusId, color);
        }
        // Defer one frame so React commits the new noteNode and ReactFlow
        // rebuilds its nodes — otherwise getNodeGeos() wouldn't see the
        // inserted card and tidyAllRoots would skip it.
        requestAnimationFrame(() => {
          // Build the geo table from BOTH ReactFlow's measured store AND the
          // authoritative `dataRef.current`. ReactFlow can lag one frame
          // behind a fresh setData (new node not yet committed to its
          // store), in which case the new card's y reads as undefined and
          // buildChildrenMap sorts it to the END of its siblings — that's
          // the v0.29.x regression. Filling in missing geos from data
          // guarantees the just-inserted card has its intended midpoint y
          // by the time tidy runs.
          const liveGeos = getNodeGeos();
          const seen = new Set(liveGeos.map((g) => g.id));
          const filler: NodeGeo[] = [];
          for (const n of dataRef.current.noteNodes) {
            if (seen.has(n.id)) continue;
            filler.push({
              id: n.id,
              x: n.x,
              y: n.y,
              w: DEFAULT_LAYOUT_CONFIG.defaultW,
              h: DEFAULT_LAYOUT_CONFIG.defaultH,
            });
          }
          for (const [id, p] of Object.entries(dataRef.current.issueMembers)) {
            if (seen.has(id)) continue;
            filler.push({
              id,
              x: p.x,
              y: p.y,
              w: DEFAULT_LAYOUT_CONFIG.defaultW,
              h: DEFAULT_LAYOUT_CONFIG.defaultH,
            });
          }
          const geosAtTidy = liveGeos.concat(filler);
          const movesAll = tidyAllRoots(
            geosAtTidy,
            dataRef.current.edges,
            DEFAULT_TIDY_CONFIG,
            dataRef.current.rootDirections,
            graphNodeIdsRef.current,
          );
          if (movesAll.length > 0) applyTidyMoves(movesAll);
          if (!newId || !placement) return;
          // Final position = tidied move, falling back to ReactFlow geo, then
          // the original placement (ReactFlow may not have measured the brand
          // new node yet when this RAF fires — never skip the pan because of
          // that).
          const move = movesAll.find((m) => m.id === newId);
          const geo = getNodeGeos().find((g) => g.id === newId);
          const x = move?.x ?? geo?.x ?? placement.x;
          const y = move?.y ?? geo?.y ?? placement.y;
          const w = geo?.w ?? DEFAULT_LAYOUT_CONFIG.defaultW;
          const h = geo?.h ?? DEFAULT_LAYOUT_CONFIG.defaultH;
          ensureNodeVisible(newId, x, y, w, h);
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linking.mode, undo, redo, getNodeGeos, insertCardWithLayout, onSelectIssue, focusNoteTextarea, reactFlow, setData, applyTidyMoves, ensureNodeVisible]);

  // Shared image-paste handler. Both the ⌘V keydown branch (when the OS
  // clipboard holds an image, in which case it wins over the in-memory
  // cards buffer) and the native `paste` event (drag-drop / non-keyboard
  // paste flows) funnel through here so the targeting + sizing logic stays
  // in one place.
  //
  // Pipeline:
  //   1. Resize source bitmap to ≤ 800px wide and re-encode as JPEG @0.85.
  //      Earlier versions kept the full clipboard PNG inline as a data URL
  //      (root cause of "this card lags / its board is slow to open" — a
  //      2000×2200 retina screenshot ballooned to a 5 MB string flowing
  //      through React state on every drag tick). We now save the bytes to
  //      disk via `save_image_bytes` (Rust, sha256 content-addressed dedup)
  //      and embed a markdown ref `![](<hash>.jpg)` in the note body.
  //   2. Decide where the ref goes:
  //      • Editing target's textarea focused → splice at cursor.
  //      • Otherwise a single note selected → append to its body.
  //      • Otherwise create a fresh image-only note at viewport centre.
  const pasteImageBlob = useCallback(
    (blob: Blob) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        if (!src.startsWith("data:image/")) return;
        const probe = new Image();
        probe.onload = () => {
          const nw = probe.naturalWidth || 256;
          const nh = probe.naturalHeight || 192;

          const MAX_W = 800;
          const downscale = Math.min(1, MAX_W / nw);
          const encW = Math.max(1, Math.round(nw * downscale));
          const encH = Math.max(1, Math.round(nh * downscale));
          const canvas = document.createElement("canvas");
          canvas.width = encW;
          canvas.height = encH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(probe, 0, 0, encW, encH);
          canvas.toBlob(
            (jpegBlob) => {
              if (!jpegBlob) return;
              const run = async () => {
                let bytes: Uint8Array;
                try {
                  const buf = await jpegBlob.arrayBuffer();
                  bytes = new Uint8Array(buf);
                } catch (err) {
                  console.error("[paste-image] arrayBuffer failed", err);
                  return;
                }
                let filename: string;
                try {
                  filename = await saveImageBytes(bytes);
                } catch (err) {
                  console.error("[paste-image] saveImageBytes failed", err);
                  return;
                }
                const ref = `![](${filename})`;

                // 1. Cursor-aware insert into a focused note textarea.
                const active = document.activeElement;
                if (
                  active instanceof HTMLTextAreaElement &&
                  active.dataset.noteTextarea
                ) {
                  const targetId = active.dataset.noteTextarea;
                  if (dataRef.current.noteNodes.some((n) => n.id === targetId)) {
                    const start = active.selectionStart ?? active.value.length;
                    const end = active.selectionEnd ?? start;
                    const before = active.value.slice(0, start);
                    const after = active.value.slice(end);
                    // Sandwich the ref with surrounding blank lines so it
                    // visually separates from neighbouring text — but only
                    // when the neighbour isn't already a blank line.
                    const leftPad = before.length === 0 || before.endsWith("\n") ? "" : "\n";
                    const rightPad = after.length === 0 || after.startsWith("\n") ? "" : "\n";
                    const insert = `${leftPad}${ref}${rightPad}`;
                    const nextBody = `${before}${insert}${after}`;
                    setData((prev) => ({
                      ...prev,
                      noteNodes: prev.noteNodes.map((n) =>
                        n.id === targetId ? { ...n, body: nextBody } : n,
                      ),
                    }));
                    // Restore cursor position right after the inserted ref so
                    // the user can keep typing. React re-renders the textarea
                    // with the new value next frame, so set the selection
                    // after that has happened.
                    const cursor = before.length + insert.length;
                    requestAnimationFrame(() => {
                      const el =
                        active.isConnected && active.dataset.noteTextarea === targetId
                          ? active
                          : (document.querySelector(
                              `textarea[data-note-textarea="${targetId}"]`,
                            ) as HTMLTextAreaElement | null);
                      if (!el) return;
                      try {
                        el.focus();
                        el.setSelectionRange(cursor, cursor);
                      } catch {
                        /* selection on a detached textarea: ignore */
                      }
                    });
                    return;
                  }
                }

                // 2. Append to currently selected note (single note only —
                // if multiple notes are selected, ambiguity → fall through
                // to "create a new note").
                const selectedNotes = reactFlow
                  .getNodes()
                  .filter((n) => n.selected && n.type === "note");
                if (selectedNotes.length === 1 && selectedNotes[0]) {
                  const targetId = selectedNotes[0].id;
                  setData((prev) => ({
                    ...prev,
                    noteNodes: prev.noteNodes.map((n) => {
                      if (n.id !== targetId) return n;
                      const tail = n.body ? `${n.body.replace(/\n+$/, "")}\n\n${ref}` : ref;
                      return { ...n, body: tail };
                    }),
                  }));
                  return;
                }

                // 3. No target → create a fresh image-only note at viewport
                // centre.
                const rect = wrapperRef.current?.getBoundingClientRect();
                const centerScreen = rect
                  ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                  : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                const center = reactFlow.screenToFlowPosition(centerScreen);
                const id = shortId("n");
                setData((prev) => ({
                  ...prev,
                  noteNodes: [
                    ...prev.noteNodes,
                    {
                      id,
                      body: ref,
                      x: center.x,
                      y: center.y,
                      cardId: mintCardIdFor(prev.noteNodes),
                    },
                  ],
                }));
                setFocusedCardId(id);
              };
              void run();
            },
            "image/jpeg",
            0.85,
          );
        };
        probe.src = src;
      };
      reader.readAsDataURL(blob);
    },
    [reactFlow, setData],
  );

  // ⌘C / ⌘V — clipboard copy/paste of selected cards.
  //
  // v0.32.0 — the OS clipboard is the ONLY source of truth. ⌘C writes a
  // namespaced envelope (`linear-board-cards:<base64-JSON>`) via
  // navigator.clipboard.writeText. ⌘V probes navigator.clipboard.read():
  //
  //   1. image mime present       → image paste (existing path)
  //   2. text starts with prefix  → decode envelope, paste cards
  //   3. plain text (no prefix)   → paste as a single note's body
  //   4. empty / read failed      → noop
  //
  // We deliberately keep zero in-memory clipboard state — earlier versions
  // had an "OS image > in-memory cards" fallback that surprised the user
  // (⌘V kept pasting old cards even when their actual clipboard was a
  // fresh screenshot or plain text). Going through the OS clipboard also
  // gives cross-app interop for free.
  const pasteCardsPayload = useCallback(
    (payload: ClipboardPayload) => {
      if (!payload || payload.items.length === 0) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const centerScreen = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const center = reactFlow.screenToFlowPosition(centerScreen);

      const localIdxToNewId: (string | null)[] = payload.items.map((it) => {
        if (it.kind === "note") return shortId("n");
        return it.id;
      });

      let skippedIssues = 0;
      let addedIssues = 0;
      let addedNotes = 0;
      // Captured outside setData so the post-commit selection sync can read
      // which ids it should highlight.
      const newlyAddedIds = new Set<string>();

      setData((prev) => {
        const issueMembers = { ...prev.issueMembers };
        const noteNodes = [...prev.noteNodes];
        const existingNoteIds = new Set(noteNodes.map((n) => n.id));
        const addedNodeIds = new Set<string>();
        const rootDirections: Record<string, RootDirection> = {
          ...(prev.rootDirections ?? {}),
        };

        // ---- Position selection ---------------------------------------
        // Try the viewport-center anchor first. If the pasted bbox would
        // overlap any existing card, try shifting through a small set of
        // candidate offsets, each constrained to keep the pasted bbox
        // inside the current viewport. If nothing clears, fall back to
        // (0, 0) — overlap is tolerable because the paste auto-selects
        // and the user can drag the group out (per user's explicit ask:
        // visible > non-overlapping).
        const W = DEFAULT_LAYOUT_CONFIG.defaultW;
        const H = DEFAULT_LAYOUT_CONFIG.defaultH;
        let pastedMinX = Infinity;
        let pastedMaxX = -Infinity;
        let pastedMinY = Infinity;
        let pastedMaxY = -Infinity;
        for (const it of payload.items) {
          const x = center.x + it.dx;
          const y = center.y + it.dy;
          if (x < pastedMinX) pastedMinX = x;
          if (x + W > pastedMaxX) pastedMaxX = x + W;
          if (y < pastedMinY) pastedMinY = y;
          if (y + H > pastedMaxY) pastedMaxY = y + H;
        }
        const existingRects: Array<{ x: number; y: number; w: number; h: number }> = [];
        for (const n of prev.noteNodes) {
          existingRects.push({ x: n.x, y: n.y, w: W, h: H });
        }
        for (const pos of Object.values(prev.issueMembers)) {
          existingRects.push({ x: pos.x, y: pos.y, w: W, h: H });
        }
        const rectsOverlap = (
          a: { x: number; y: number; w: number; h: number },
          minX: number,
          minY: number,
          maxX: number,
          maxY: number,
        ) => a.x < maxX && a.x + a.w > minX && a.y < maxY && a.y + a.h > minY;
        // Viewport bbox in flow coords (so candidate positions stay visible).
        const vpTopLeft = reactFlow.screenToFlowPosition(
          rect
            ? { x: rect.left, y: rect.top }
            : { x: 0, y: 0 },
        );
        const vpBotRight = reactFlow.screenToFlowPosition(
          rect
            ? { x: rect.right, y: rect.bottom }
            : { x: window.innerWidth, y: window.innerHeight },
        );
        const PASTE_GAP = 80;
        const stepX = W + PASTE_GAP;
        const stepY = H + PASTE_GAP;
        const candidates: Array<{ dx: number; dy: number }> = [
          { dx: 0, dy: 0 },
          { dx: stepX, dy: 0 },
          { dx: 0, dy: stepY },
          { dx: -stepX, dy: 0 },
          { dx: 0, dy: -stepY },
          { dx: stepX, dy: stepY },
          { dx: -stepX, dy: stepY },
          { dx: stepX, dy: -stepY },
          { dx: -stepX, dy: -stepY },
          { dx: 2 * stepX, dy: 0 },
          { dx: 0, dy: 2 * stepY },
          { dx: -2 * stepX, dy: 0 },
          { dx: 0, dy: -2 * stepY },
        ];
        let shiftX = 0;
        let shiftY = 0;
        for (const c of candidates) {
          const minX = pastedMinX + c.dx;
          const maxX = pastedMaxX + c.dx;
          const minY = pastedMinY + c.dy;
          const maxY = pastedMaxY + c.dy;
          // Keep pasted bbox inside the viewport (with a half-card slack
          // so we don't reject candidates that are flush to the edge).
          const SLACK = W / 2;
          if (
            minX < vpTopLeft.x - SLACK ||
            maxX > vpBotRight.x + SLACK ||
            minY < vpTopLeft.y - SLACK ||
            maxY > vpBotRight.y + SLACK
          ) {
            continue;
          }
          const collides = existingRects.some((r) =>
            rectsOverlap(r, minX, minY, maxX, maxY),
          );
          if (collides) continue;
          shiftX = c.dx;
          shiftY = c.dy;
          break;
        }

        payload.items.forEach((it, idx) => {
          const x = center.x + it.dx + shiftX;
          const y = center.y + it.dy + shiftY;
          if (it.kind === "issue") {
            if (issueMembers[it.id]) {
              skippedIssues += 1;
              localIdxToNewId[idx] = null;
              return;
            }
            issueMembers[it.id] = { x, y };
            addedNodeIds.add(it.id);
            newlyAddedIds.add(it.id);
            addedIssues += 1;
            if (it.direction) rootDirections[it.id] = it.direction;
          } else {
            let id = localIdxToNewId[idx];
            if (!id || existingNoteIds.has(id)) {
              id = shortId("n");
              localIdxToNewId[idx] = id;
            }
            const note: { id: string; body: string; x: number; y: number; color?: string; working?: boolean; done?: boolean; cardId?: string } = {
              id,
              body: it.body,
              x,
              y,
              cardId: mintCardIdFor(noteNodes),
            };
            if (it.color) note.color = it.color;
            if (it.working) note.working = true;
            if (it.done) note.done = true;
            noteNodes.push(note);
            existingNoteIds.add(id);
            addedNodeIds.add(id);
            newlyAddedIds.add(id);
            addedNotes += 1;
            if (it.direction) rootDirections[id] = it.direction;
          }
        });

        const newEdges: BoardEdge[] = [];
        for (const e of payload.edges) {
          const s = localIdxToNewId[e.sourceLocalIdx];
          const t = localIdxToNewId[e.targetLocalIdx];
          if (!s || !t) continue;
          if (!addedNodeIds.has(s) || !addedNodeIds.has(t)) continue;
          const out: BoardEdge = { id: shortId("e"), source: s, target: t };
          if (e.label) out.label = e.label;
          if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
          if (e.targetHandle) out.targetHandle = e.targetHandle;
          newEdges.push(out);
        }

        return {
          ...prev,
          issueMembers,
          noteNodes,
          edges: [...prev.edges, ...newEdges],
          rootDirections,
        };
      });

      // Hand the new ids to the nodes-rebuild useEffect (which fires
      // synchronously after the data update commits) so it sets selection
      // in the same render. A RAF here can lose against the rebuild and
      // get its selection wiped — caught by codex review on v0.35.0.
      if (newlyAddedIds.size > 0) {
        pendingSelectionRef.current = new Set(newlyAddedIds);
      }

      const parts: string[] = [];
      if (addedIssues) parts.push(`${addedIssues} issue`);
      if (addedNotes) parts.push(`${addedNotes} note`);
      const summary = parts.length ? parts.join(" + ") : "0 项";
      const note = skippedIssues ? `（${skippedIssues} 个 issue 已存在跳过）` : "";
      onClipboardToast?.(
        skippedIssues && !addedIssues && !addedNotes ? "info" : "success",
        `粘贴 ${summary}${note}`,
      );
    },
    [reactFlow, setData, onClipboardToast],
  );

  const pasteTextAsNote = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const centerScreen = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const center = reactFlow.screenToFlowPosition(centerScreen);
      const id = shortId("n");
      setData((prev) => ({
        ...prev,
        noteNodes: [
          ...prev.noteNodes,
          {
            id,
            body,
            x: center.x,
            y: center.y,
            cardId: mintCardIdFor(prev.noteNodes),
          },
        ],
      }));
      setFocusedCardId(id);
    },
    [reactFlow, setData],
  );

  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onKey = (evt: KeyboardEvent) => {
      if (!(evt.metaKey || evt.ctrlKey)) return;
      if (evt.key !== "c" && evt.key !== "C" && evt.key !== "v" && evt.key !== "V") return;
      if (isEditable(evt.target) || isEditable(document.activeElement)) return;

      const isCopy = evt.key === "c" || evt.key === "C";
      if (isCopy) {
        const selectedNodes = reactFlow.getNodes().filter((n) => n.selected);
        if (selectedNodes.length === 0) return;
        evt.preventDefault();

        // Group centroid for relative offsets.
        let cx = 0;
        let cy = 0;
        for (const n of selectedNodes) {
          cx += n.position.x;
          cy += n.position.y;
        }
        cx /= selectedNodes.length;
        cy /= selectedNodes.length;

        const items: ClipboardItem[] = [];
        const idToLocalIdx = new Map<string, number>();
        const rootDirs = dataRef.current.rootDirections ?? {};
        for (const n of selectedNodes) {
          const dx = n.position.x - cx;
          const dy = n.position.y - cy;
          const dir = rootDirs[n.id];
          if (n.type === "issue") {
            const item: ClipboardItem = { kind: "issue", id: n.id, dx, dy };
            if (dir) item.direction = dir;
            items.push(item);
          } else if (n.type === "note") {
            const note = dataRef.current.noteNodes.find((nn) => nn.id === n.id);
            if (!note) continue;
            const item: ClipboardItem = {
              kind: "note",
              body: note.body,
              color: note.color,
              working: note.working,
              done: note.done,
              dx,
              dy,
            };
            if (dir) item.direction = dir;
            items.push(item);
          } else {
            continue;
          }
          idToLocalIdx.set(n.id, items.length - 1);
        }
        if (items.length === 0) return;

        const edges: ClipboardEdge[] = [];
        for (const e of dataRef.current.edges) {
          const s = idToLocalIdx.get(e.source);
          const t = idToLocalIdx.get(e.target);
          if (s === undefined || t === undefined) continue;
          const out: ClipboardEdge = { sourceLocalIdx: s, targetLocalIdx: t };
          if (e.label) out.label = e.label;
          if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
          if (e.targetHandle) out.targetHandle = e.targetHandle;
          edges.push(out);
        }

        const payload: ClipboardPayload = { items, edges, copiedAt: Date.now() };
        const envelope = encodeCardsEnvelope(payload);
        const writeAsync = async () => {
          try {
            await navigator.clipboard.writeText(envelope);
            onClipboardToast?.(
              "success",
              `已复制 ${items.length} 项${edges.length ? ` + ${edges.length} 条 edge` : ""}`,
            );
          } catch (err) {
            console.error("[⌘C] clipboard write failed", err);
            onClipboardToast?.("error", `复制失败: ${String(err)}`);
          }
        };
        void writeAsync();
        return;
      }

      // ⌘V — do NOT intercept here. Earlier versions called
      // `navigator.clipboard.read()` from this keydown branch, which in
      // Tauri's WKWebView triggers Apple's "Paste" permission overlay (a
      // big system button the user has to click). The native `paste` event
      // bound below already has the clipboard data attached synchronously,
      // no permission prompt, and bubbles from the focused element so
      // textarea pastes still go where they should. Let it through.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reactFlow, onClipboardToast, pasteImageBlob, pasteCardsPayload, pasteTextAsNote]);

  // Single paste pipeline: ⌘V fires a synthetic native `paste` event with
  // `clipboardData` already populated by WebKit (no async clipboard.read
  // call, so no "Paste" permission overlay in Tauri WKWebView). Routes:
  //   1. Image file → pasteImageBlob, preventDefault
  //   2. Cards envelope text → pasteCardsPayload, preventDefault
  //   3. Plain text — only intercept when focus is on the canvas (not a
  //      textarea / contenteditable), so inline note editing still uses the
  //      default text insertion path.
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onPaste = (evt: ClipboardEvent) => {
      const dt = evt.clipboardData;
      if (!dt) return;
      // 1. Image branch — wins over text for clipboard items that carry both.
      let file: File | null = null;
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it && it.kind === "file" && it.type.startsWith("image/")) {
          file = it.getAsFile();
          break;
        }
      }
      if (file) {
        evt.preventDefault();
        pasteImageBlob(file);
        return;
      }
      // 2. Cards envelope — text we previously wrote with the prefix.
      const text = dt.getData("text/plain");
      if (text) {
        const cards = decodeCardsEnvelope(text);
        if (cards) {
          evt.preventDefault();
          pasteCardsPayload(cards);
          return;
        }
      }
      // 3. Plain text fallback. Let WebKit handle pastes into editable
      // targets natively; only redirect to "paste as a new note" when the
      // focus is on the bare canvas.
      if (!text) return;
      if (isEditableTarget(evt.target) || isEditableTarget(document.activeElement)) {
        return;
      }
      evt.preventDefault();
      pasteTextAsNote(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteImageBlob, pasteCardsPayload, pasteTextAsNote]);

  // Drag the entire group by grabbing the dashed frame's empty interior
  // (frame sits at zIndex -1 so cards still catch clicks on their own area).
  // We bypass xyflow's drag system here — read start positions straight from
  // `data` so members that are currently filtered out (e.g. in All Issues
  // view) still come along; live-translate the visible ones in `nodes`
  // state during the move; commit the final positions for every member to
  // `data` on release.
  const startGroupDrag = useCallback(
    (evt: React.PointerEvent<HTMLDivElement>, groupId: string) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      const group = dataRef.current.groups.find((g) => g.id === groupId);
      if (!group) return;
      const startFlow = reactFlow.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      const startPositions = new Map<string, { x: number; y: number }>();
      const d = dataRef.current;
      for (const id of group.memberIds) {
        if (d.issueMembers[id]) {
          startPositions.set(id, { ...d.issueMembers[id] });
        } else {
          const note = d.noteNodes.find((n) => n.id === id);
          if (note) startPositions.set(id, { x: note.x, y: note.y });
        }
      }
      if (startPositions.size === 0) return;

      let lastDx = 0;
      let lastDy = 0;
      const onMove = (mev: PointerEvent) => {
        const cur = reactFlow.screenToFlowPosition({ x: mev.clientX, y: mev.clientY });
        lastDx = cur.x - startFlow.x;
        lastDy = cur.y - startFlow.y;
        setNodes((prev) =>
          prev.map((n) => {
            const start = startPositions.get(n.id);
            if (!start) return n;
            return { ...n, position: { x: start.x + lastDx, y: start.y + lastDy } };
          }),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (lastDx === 0 && lastDy === 0) return;
        setData((prev) => {
          const issueMembers = { ...prev.issueMembers };
          const noteNodes = [...prev.noteNodes];
          for (const [id, start] of startPositions) {
            const finalX = start.x + lastDx;
            const finalY = start.y + lastDy;
            if (issueMembers[id]) {
              issueMembers[id] = { x: finalX, y: finalY };
            } else {
              const idx = noteNodes.findIndex((n) => n.id === id);
              if (idx >= 0) {
                noteNodes[idx] = { ...noteNodes[idx]!, x: finalX, y: finalY };
              }
            }
          }
          return { ...prev, issueMembers, noteNodes };
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [reactFlow, setData],
  );

  // Bounding rects for each group, computed from live node positions so the
  // frame tracks every drag in real time. Read from local `nodes` state (not
  // `data`) because xyflow only writes positions back to data on drag-settle.
  const groupFrames = useMemo(() => {
    if (data.groups.length === 0) return [];
    const byId = new Map<string, Node>();
    for (const n of nodes) byId.set(n.id, n);
    const PAD = 10;
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const g of data.groups) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let count = 0;
      for (const id of g.memberIds) {
        const n = byId.get(id);
        if (!n) continue;
        const { w, h } = nodeSize(n);
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
        count += 1;
      }
      if (count < 2) continue;
      out.push({
        id: g.id,
        x: minX - PAD,
        y: minY - PAD,
        w: maxX - minX + PAD * 2,
        h: maxY - minY + PAD * 2,
      });
    }
    return out;
  }, [data.groups, nodes]);

  // Resolve a friendly label for the source node so the user remembers what they picked.
  const sourceLabel = useMemo(() => {
    if (linking.mode !== "target") return null;
    const id = linking.source;
    if (issuesById.has(id)) {
      const iss = issuesById.get(id)!;
      return `${iss.identifier} · ${iss.title}`;
    }
    const note = data.noteNodes.find((n) => n.id === id);
    if (note) {
      const title = note.body.split("\n")[0]?.trim();
      return `note · ${title || "(untitled)"}`;
    }
    return id;
  }, [linking, issuesById, data.noteNodes]);

  const onPaneClick = useCallback(
    (_evt: React.MouseEvent) => {
      setMenu(null);
      // Empty-pane click during connect mode is the user's "stop" gesture —
      // exit linking and don't deselect anything else.
      if (linking.mode !== "off") {
        setLinking({ mode: "off" });
        return;
      }
      setFocusedCardId(null);
      onSelectIssue?.(null);
    },
    [linking.mode, onSelectIssue],
  );

  // Double-click on the empty pane creates a new note. We attach this at the
  // wrapper level (not via onPaneClick) because `selectionOnDrag` makes
  // ReactFlow consume click events for selection start/end, which breaks
  // detail===2 detection on the pane handler.
  const onWrapperDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      const target = evt.target as Element | null;
      if (!target) return;
      if (target.closest(".react-flow__node")) return;
      if (target.closest(".react-flow__edge")) return;
      if (target.closest(".react-flow__controls")) return;
      if (target.closest(".react-flow__minimap")) return;
      if (target.closest("[data-no-create]")) return;

      const pt = reactFlow.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      const id = shortId("n");
      setData((prev) => ({
        ...prev,
        noteNodes: [...prev.noteNodes, { id, body: "", x: pt.x, y: pt.y, cardId: mintCardIdFor(prev.noteNodes) }],
      }));
      setEditingNoteId(id);
      setFocusedCardId(id);
      focusNoteTextarea(id);
    },
    [reactFlow, setData, focusNoteTextarea],
  );

  const localCoords = useCallback((evt: { clientX: number; clientY: number }) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    return rect
      ? { x: evt.clientX - rect.left, y: evt.clientY - rect.top }
      : { x: evt.clientX, y: evt.clientY };
  }, []);

  // --- destructive helpers used by the per-target menu builders below ---
  const removeIssueFromBoard = useCallback(
    (id: string) => {
      setData((prev) => {
        const pruneGroups = prev.groups
          .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
          .filter((g) => g.memberIds.length >= 2);
        const { [id]: _drop, ...rest } = prev.issueMembers;
        void _drop;
        return {
          ...prev,
          issueMembers: rest,
          edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
          groups: pruneGroups,
        };
      });
    },
    [setData],
  );

  const deleteNote = useCallback(
    (id: string) => {
      setData((prev) => {
        const pruneGroups = prev.groups
          .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
          .filter((g) => g.memberIds.length >= 2);
        return {
          ...prev,
          noteNodes: prev.noteNodes.filter((n) => n.id !== id),
          edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
          groups: pruneGroups,
        };
      });
    },
    [setData],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setData((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== id) }));
    },
    [setData],
  );

  // Set a tree-root direction, then immediately re-tidy that root's subtree
  // so the layout matches the new axis. Save is debounced via setData.
  const setRootDirection = useCallback(
    (rootId: string, dir: RootDirection) => {
      setData((prev) => {
        const cur = prev.rootDirections?.[rootId];
        if (cur === dir) return prev;
        const next: Record<string, RootDirection> = { ...(prev.rootDirections ?? {}) };
        next[rootId] = dir;
        return { ...prev, rootDirections: next };
      });
      // Tidy fires one frame later so the rootDirections update propagates
      // through React before tidy consults it. Use tidyAllRoots so neighbor
      // subtrees re-stack around the changed tree (its bbox shape just
      // changed, so a per-tree tidy would leave overlaps).
      requestAnimationFrame(() => {
        const geoFn = getNodeGeosRef.current;
        const applyFn = applyTidyMovesRef.current;
        if (!geoFn || !applyFn) return;
        const moves = tidyAllRoots(
          geoFn(),
          dataRef.current.edges,
          DEFAULT_TIDY_CONFIG,
          dataRef.current.rootDirections,
          graphNodeIdsRef.current,
        );
        if (moves.length > 0) applyFn(moves);
      });
    },
    [setData],
  );

  // Each contextMenu handler builds its own item list — adding new rows for a
  // given target type just means appending here. No central dispatcher needed.
  const onNodeContextMenu = useCallback(
    (evt: React.MouseEvent, node: Node) => {
      evt.preventDefault();
      const { x, y } = localCoords(evt);
      const items: MenuItem[] = [];
      // Domain-level graph membership — read from the single selector so the
      // checkmark always matches what the edge renderer / F exemption see.
      const inGraphDomain = graphNodeIds.has(node.id);
      if (node.type === "note") {
        const note = dataRef.current.noteNodes.find((n) => n.id === node.id);
        if (note?.cardId) {
          const cid = note.cardId;
          items.push({
            id: "copy-card-id",
            label: `Copy ID  [[${cid}]]`,
            onSelect: () => copyCardId(cid),
          });
        }
        items.push({
          id: "delete-note",
          label: "Delete note",
          tone: "danger",
          onSelect: () => deleteNote(node.id),
        });
        // Graph toggle — ✓ when this card's connected component is rendered
        // as a graph (any member flagged). Clicking toggles THIS card's flag.
        items.push({
          id: "graph-toggle",
          label: "Graph",
          checked: inGraphDomain,
          separatorAbove: true,
          onSelect: () => toggleGraphFlag(node.id),
        });
      } else {
        items.push({
          id: "remove-issue",
          label: "Remove from board",
          tone: "danger",
          onSelect: () => removeIssueFromBoard(node.id),
        });
      }

      // Direction picker — only on mindmap roots (no incoming edges). Reads
      // current direction (default "right") and shows it with a leading ✓.
      // Clicking a row writes back the new direction and re-tidies the
      // subtree synchronously so the user sees the new axis immediately.
      // Hidden entirely when the card's domain is a graph — growth direction
      // is a tree concept and means nothing for graph rendering.
      const hasIncoming = dataRef.current.edges.some((e) => e.target === node.id);
      if (!hasIncoming && !inGraphDomain) {
        const cur: RootDirection = dataRef.current.rootDirections?.[node.id] ?? "right";
        const dirItems: { id: string; label: string; dir: RootDirection }[] = [
          { id: "dir-right", label: "Direction: Right", dir: "right" },
          { id: "dir-left", label: "Direction: Left", dir: "left" },
          { id: "dir-up", label: "Direction: Up", dir: "up" },
          { id: "dir-down", label: "Direction: Down", dir: "down" },
        ];
        dirItems.forEach((d, i) => {
          items.push({
            id: d.id,
            label: d.label,
            checked: cur === d.dir,
            separatorAbove: i === 0,
            onSelect: () => setRootDirection(node.id, d.dir),
          });
        });
      }

      setMenu({ x, y, items });
    },
    [localCoords, copyCardId, deleteNote, removeIssueFromBoard, setRootDirection, graphNodeIds, toggleGraphFlag],
  );

  const onEdgeContextMenu = useCallback(
    (evt: React.MouseEvent, edge: Edge) => {
      evt.preventDefault();
      const { x, y } = localCoords(evt);
      const id = edge.id;
      setMenu({
        x,
        y,
        items: [
          {
            id: "delete-edge",
            label: "Delete connection",
            tone: "danger",
            onSelect: () => deleteEdge(id),
          },
        ],
      });
    },
    [localCoords, deleteEdge],
  );

  const onEdgeDoubleClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    setEditingEdgeId(edge.id);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      onDoubleClick={onWrapperDoubleClick}
    >
      {!loaded && (
        <div style={{ position: "absolute", top: 12, left: 12, color: "var(--muted)", fontSize: 11, zIndex: 5 }}>
          {loadingLabel ?? "loading board…"}
        </div>
      )}
      {linking.mode !== "off" && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--paper)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            padding: "6px 14px",
            boxShadow: "0 4px 14px rgba(26,24,20,0.18)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--sans)",
            fontSize: 12,
            color: "var(--ink)",
            zIndex: 30,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--warm-red)",
              fontWeight: 700,
            }}
          >
            Linking
          </span>
          <span style={{ color: "var(--ink-soft)" }}>
            {linking.mode === "source"
              ? "click source card"
              : `from ${sourceLabel} → click target`}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 10 }}>esc / x to cancel</span>
        </div>
      )}
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable
        nodesFocusable={false}
        edgesFocusable
        deleteKeyCode={["Backspace", "Delete"]}
        {...SHARED_FLOW_PROPS}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.6} color="rgba(120,116,108,0.38)" />
        <ViewportPortal>
          {groupFrames.map((f) => (
            <div
              key={`grp-${f.id}`}
              onPointerDown={(e) => startGroupDrag(e, f.id)}
              style={{
                position: "absolute",
                left: f.x,
                top: f.y,
                width: f.w,
                height: f.h,
                border: "1.5px dashed var(--selection-dash)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--selection-dash) 5%, transparent)",
                // Pointer-events on so the empty interior (and the dashed
                // border) drags the whole group; zIndex -1 keeps cards on top
                // so clicking a card still hits the card, not the frame.
                pointerEvents: "auto",
                cursor: "move",
                zIndex: -1,
              }}
            />
          ))}
          {snapGuides.map((g, i) => (
            <div
              key={`a${i}`}
              style={{
                position: "absolute",
                left: g.axis === "v" ? g.pos - 0.5 : g.start,
                top: g.axis === "v" ? g.start : g.pos - 0.5,
                width: g.axis === "v" ? 1 : g.end - g.start,
                height: g.axis === "v" ? g.end - g.start : 1,
                background: "var(--warm-red)",
                opacity: 0.85,
                pointerEvents: "none",
                zIndex: 10,
              }}
            />
          ))}
          {gapGuides.map((g, i) =>
            g.axis === "x" ? (
              <div key={`g${i}`}>
                <div
                  style={{
                    position: "absolute",
                    left: g.span1[0],
                    top: g.pos - 0.5,
                    width: g.span1[1] - g.span1[0],
                    height: 1,
                    background: "var(--warm-red)",
                    opacity: 0.85,
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: g.span2[0],
                    top: g.pos - 0.5,
                    width: g.span2[1] - g.span2[0],
                    height: 1,
                    background: "var(--warm-red)",
                    opacity: 0.85,
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                />
                {/* Caps at both ends of each span */}
                {[g.span1[0], g.span1[1], g.span2[0], g.span2[1]].map((x, j) => (
                  <div
                    key={`gc${i}_${j}`}
                    style={{
                      position: "absolute",
                      left: x - 0.5,
                      top: g.pos - 4,
                      width: 1,
                      height: 8,
                      background: "var(--warm-red)",
                      opacity: 0.85,
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div key={`g${i}`}>
                <div
                  style={{
                    position: "absolute",
                    left: g.pos - 0.5,
                    top: g.span1[0],
                    width: 1,
                    height: g.span1[1] - g.span1[0],
                    background: "var(--warm-red)",
                    opacity: 0.85,
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: g.pos - 0.5,
                    top: g.span2[0],
                    width: 1,
                    height: g.span2[1] - g.span2[0],
                    background: "var(--warm-red)",
                    opacity: 0.85,
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                />
                {[g.span1[0], g.span1[1], g.span2[0], g.span2[1]].map((y, j) => (
                  <div
                    key={`gc${i}_${j}`}
                    style={{
                      position: "absolute",
                      left: g.pos - 4,
                      top: y - 0.5,
                      width: 8,
                      height: 1,
                      background: "var(--warm-red)",
                      opacity: 0.85,
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  />
                ))}
              </div>
            ),
          )}
        </ViewportPortal>
        <NoteSelectionPalette onApply={commitNotesColor} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          maskColor="rgba(244,236,221,0.65)"
          nodeColor="rgba(26,24,20,0.35)"
          nodeStrokeColor="transparent"
        />
      </ReactFlow>
      {menu && (
        <BoardContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

const CanvasBoard = forwardRef<CanvasBoardHandle, CanvasBoardProps>(function CanvasBoard(
  props,
  ref,
) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} forwardedRef={ref} />
    </ReactFlowProvider>
  );
});

export default CanvasBoard;
