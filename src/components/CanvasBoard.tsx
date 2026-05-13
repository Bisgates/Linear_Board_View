import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  MarkerType,
  ViewportPortal,
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
import { NoteCard } from "./NoteCard";
import { LabeledEdge } from "./LabeledEdge";
import { BoardContextMenu, type ContextMenuTarget } from "./BoardContextMenu";
import { SHARED_FLOW_PROPS } from "../lib/boardProps";
import type { BoardData, BoardEdge } from "../lib/workingOn";
import { shortId } from "../lib/workingOn";

const NODE_TYPES: NodeTypes = {
  issue: IssueCard as unknown as NodeTypes[string],
  note: NoteCard as unknown as NodeTypes[string],
};
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
}

function buildNodes(
  displayedIssues: IssueRecord[],
  data: BoardData,
  initialPositions: Record<string, { x: number; y: number }> | undefined,
  editingNoteId: string | null,
): Node[] {
  const nodes: Node[] = [];
  for (const issue of displayedIssues) {
    const pos = data.issueMembers[issue.id] ?? initialPositions?.[issue.id] ?? { x: 0, y: 0 };
    nodes.push({
      id: issue.id,
      type: "issue",
      position: { x: pos.x, y: pos.y },
      data: issue as unknown as Record<string, unknown>,
      draggable: true,
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
        autoEdit: note.id === editingNoteId,
      } as unknown as Record<string, unknown>,
      draggable: true,
    });
  }
  return nodes;
}

const EDGE_COLOR = "#7a7060"; // warm taupe — sits quietly on paper, not shouty

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

function buildEdges(data: BoardData, editingEdgeId: string | null): Edge[] {
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: "labeled",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: EDGE_COLOR,
      width: 16,
      height: 16,
    },
    style: { stroke: EDGE_COLOR, strokeWidth: 1.6 },
    data: {
      label: e.label ?? "",
      editing: editingEdgeId === e.id,
    } as Record<string, unknown>,
  }));
}

function BoardInner({
  displayedIssues,
  data,
  loaded,
  setData,
  undo,
  onSelectIssue,
  selectedIssueId,
  initialPositions,
  loadingLabel,
}: CanvasBoardProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [linking, setLinking] = useState<
    { mode: "off" } | { mode: "source" } | { mode: "target"; source: string }
  >({ mode: "off" });
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const linkJustFinishedRef = useRef(0);
  const [snapGuides, setSnapGuides] = useState<Guide[]>([]);
  const [gapGuides, setGapGuides] = useState<GapGuide[]>([]);

  const [edges, setEdges] = useState<Edge[]>([]);

  const issuesById = useMemo(() => {
    const m = new Map<string, IssueRecord>();
    for (const i of displayedIssues) m.set(i.id, i);
    return m;
  }, [displayedIssues]);

  // Rebuild nodes when data shape changes (counts / contents).
  useEffect(() => {
    setNodes(buildNodes(displayedIssues, data, initialPositions, editingNoteId));
  }, [displayedIssues, data, initialPositions, editingNoteId]);

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

  // Sync selection halo from outside.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) =>
        n.selected === (n.id === selectedIssueId) ? n : { ...n, selected: n.id === selectedIssueId },
      ),
    );
  }, [selectedIssueId]);

  const commitNote = useCallback(
    (id: string, patch: { body?: string; color?: string }) => {
      setData((prev) => ({
        ...prev,
        noteNodes: prev.noteNodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
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

  // Augment note nodes with edit handlers (passed via data; functions are stable enough per render).
  const decoratedNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.type !== "note") return n;
      return {
        ...n,
        data: {
          ...n.data,
          onCommit: (patch: { body?: string; color?: string }) => commitNote(n.id, patch),
          onEditEnd: noteEditingFinished,
        } as unknown as Record<string, unknown>,
      };
    });
  }, [nodes, commitNote, noteEditingFinished]);

  const decoratedEdges = useMemo(() => {
    return edges.map((e) => ({
      ...e,
      data: {
        ...(e.data ?? {}),
        onCommit: (label: string) => commitEdgeLabel(e.id, label),
        onEditEnd: edgeEditingFinished,
      } as Record<string, unknown>,
    }));
  }, [edges, commitEdgeLabel, edgeEditingFinished]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        // Snap-to-align (edge + equal-gap): rewrite live drag position changes
        // when within SNAP_THRESHOLD of another node's edge / centre line, or
        // when D could equalise the gap between two stationary cards. Emit
        // matching guides until release.
        let liveGuides: Guide[] | null = null;
        let liveGapGuides: GapGuide[] | null = null;
        const adjusted = changes.map((c) => {
          if (c.type === "position" && c.dragging && c.position) {
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

        const anyLiveDrag = changes.some(
          (c) => c.type === "position" && c.dragging === true,
        );
        if (!anyLiveDrag) {
          if (snapGuides.length > 0) setSnapGuides([]);
          if (gapGuides.length > 0) setGapGuides([]);
        } else {
          if (liveGuides) setSnapGuides(liveGuides);
          if (liveGapGuides) setGapGuides(liveGapGuides);
        }

        const next = applyNodeChanges(adjusted, current);
        const settled = adjusted.filter(
          (c): c is Extract<NodeChange, { type: "position" }> =>
            c.type === "position" && c.dragging === false,
        );
        if (settled.length > 0) {
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
            return { ...prev, issueMembers, noteNodes };
          });
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
        return {
          ...prev,
          issueMembers,
          noteNodes: prev.noteNodes.filter((n) => !ids.has(n.id)),
          edges: prev.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
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
        setLinking({ mode: "off" });
        return;
      }
      if (node.type === "issue") onSelectIssue?.(node.id);
    },
    [linking, setData, onSelectIssue, data],
  );

  // Global hotkeys: X = link mode, C = undo, Esc = cancel link mode.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onKey = (evt: KeyboardEvent) => {
      if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
      if (isEditable(evt.target) || isEditable(document.activeElement)) return;
      if (evt.key === "Escape" && linking.mode !== "off") {
        setLinking({ mode: "off" });
        return;
      }
      if (evt.key === "x" || evt.key === "X") {
        evt.preventDefault();
        setLinking((prev) => (prev.mode === "off" ? { mode: "source" } : { mode: "off" }));
        return;
      }
      if ((evt.key === "c" || evt.key === "C" || evt.code === "KeyC") && undo) {
        evt.preventDefault();
        const ok = undo();
        console.log(`[canvas-board] undo via C key → ${ok ? "ok" : "nothing to undo"}`);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linking.mode, undo]);

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

  // Imperatively focus a freshly-created note's textarea — wins races with
  // ReactFlow's pane focus refresh and StrictMode mount/cleanup.
  const focusNewNote = useCallback((id: string) => {
    const grab = () => {
      const el = document.querySelector(
        `textarea[data-note-textarea="${id}"]`,
      ) as HTMLTextAreaElement | null;
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

  const onPaneClick = useCallback(
    (evt: React.MouseEvent) => {
      setMenu(null);
      // Linking mode: second click on empty pane spawns a new note at the
      // cursor and wires the source → note edge in one undo step.
      if (linking.mode === "target") {
        const pt = reactFlow.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
        const noteId = shortId("n");
        const edgeId = shortId("e");
        const srcId = linking.source;
        setData((prev) => ({
          ...prev,
          noteNodes: [...prev.noteNodes, { id: noteId, body: "", x: pt.x, y: pt.y }],
          edges: [
            ...prev.edges,
            { id: edgeId, source: srcId, target: noteId } satisfies BoardEdge,
          ],
        }));
        setEditingNoteId(noteId);
        setLinking({ mode: "off" });
        linkJustFinishedRef.current = Date.now();
        focusNewNote(noteId);
        return;
      }
      onSelectIssue?.(null);
    },
    [linking, reactFlow, setData, focusNewNote, onSelectIssue],
  );

  // Double-click on the empty pane creates a new note. We attach this at the
  // wrapper level (not via onPaneClick) because `selectionOnDrag` makes
  // ReactFlow consume click events for selection start/end, which breaks
  // detail===2 detection on the pane handler.
  const onWrapperDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      // Suppress the dblclick branch if the leading click just spawned a linked
      // note (otherwise a fast double-click in linking mode would create two).
      if (Date.now() - linkJustFinishedRef.current < 400) return;

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
        noteNodes: [...prev.noteNodes, { id, body: "", x: pt.x, y: pt.y }],
      }));
      setEditingNoteId(id);
      focusNewNote(id);
    },
    [reactFlow, setData, focusNewNote],
  );

  const localCoords = useCallback((evt: { clientX: number; clientY: number }) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    return rect
      ? { x: evt.clientX - rect.left, y: evt.clientY - rect.top }
      : { x: evt.clientX, y: evt.clientY };
  }, []);

  const onNodeContextMenu = useCallback(
    (evt: React.MouseEvent, node: Node) => {
      evt.preventDefault();
      const target: ContextMenuTarget =
        node.type === "issue"
          ? { kind: "issue", id: node.id }
          : { kind: "note", id: node.id };
      const { x, y } = localCoords(evt);
      setMenu({ x, y, target });
    },
    [localCoords],
  );

  const onEdgeContextMenu = useCallback(
    (evt: React.MouseEvent, edge: Edge) => {
      evt.preventDefault();
      const { x, y } = localCoords(evt);
      setMenu({ x, y, target: { kind: "edge", id: edge.id } });
    },
    [localCoords],
  );

  const onEdgeDoubleClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    setEditingEdgeId(edge.id);
  }, []);

  const handleMenuAction = useCallback(
    (target: ContextMenuTarget) => {
      setMenu(null);
      setData((prev) => {
        if (target.kind === "issue") {
          const { [target.id]: _drop, ...rest } = prev.issueMembers;
          void _drop;
          return {
            ...prev,
            issueMembers: rest,
            edges: prev.edges.filter((e) => e.source !== target.id && e.target !== target.id),
          };
        }
        if (target.kind === "note") {
          return {
            ...prev,
            noteNodes: prev.noteNodes.filter((n) => n.id !== target.id),
            edges: prev.edges.filter((e) => e.source !== target.id && e.target !== target.id),
          };
        }
        return { ...prev, edges: prev.edges.filter((e) => e.id !== target.id) };
      });
    },
    [setData],
  );

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
      >
        <Background gap={24} size={1} color="rgba(26,24,20,0.08)" />
        <ViewportPortal>
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
          target={menu.target}
          onAction={handleMenuAction}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export default function CanvasBoard(props: CanvasBoardProps) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}
