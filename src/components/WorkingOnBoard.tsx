import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  MarkerType,
  SelectionMode,
  applyNodeChanges,
  type Edge,
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
import { WorkingOnContextMenu, type ContextMenuTarget } from "./WorkingOnContextMenu";
import type { WorkingOnData, WorkingOnEdge } from "../lib/workingOn";
import { shortId } from "../lib/workingOn";

const NODE_TYPES: NodeTypes = {
  issue: IssueCard as unknown as NodeTypes[string],
  note: NoteCard as unknown as NodeTypes[string],
};
const EDGE_TYPES: EdgeTypes = {
  labeled: LabeledEdge as unknown as EdgeTypes[string],
};

interface WorkingOnBoardProps {
  data: WorkingOnData;
  loaded: boolean;
  issuesById: Map<string, IssueRecord>;
  setData: (updater: WorkingOnData | ((prev: WorkingOnData) => WorkingOnData)) => void;
  onSelectIssue?: (id: string | null) => void;
  selectedIssueId?: string | null;
}

function buildNodes(data: WorkingOnData, issuesById: Map<string, IssueRecord>, editingNoteId: string | null): Node[] {
  const nodes: Node[] = [];
  for (const [issueId, pos] of Object.entries(data.issueMembers)) {
    const issue = issuesById.get(issueId);
    if (!issue) continue;
    nodes.push({
      id: issueId,
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
      data: { id: note.id, body: note.body, autoEdit: note.id === editingNoteId } as unknown as Record<string, unknown>,
      draggable: true,
    });
  }
  return nodes;
}

function buildEdges(data: WorkingOnData, editingEdgeId: string | null): Edge[] {
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: "labeled",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#b23a48",
      width: 18,
      height: 18,
    },
    style: { stroke: "#b23a48", strokeWidth: 2 },
    data: {
      label: e.label ?? "",
      editing: editingEdgeId === e.id,
    } as Record<string, unknown>,
  }));
}

function BoardInner({ data, loaded, issuesById, setData, onSelectIssue, selectedIssueId }: WorkingOnBoardProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const edges = useMemo(() => buildEdges(data, editingEdgeId), [data, editingEdgeId]);

  // Rebuild nodes when data shape changes (counts / contents).
  useEffect(() => {
    setNodes(buildNodes(data, issuesById, editingNoteId));
  }, [data, issuesById, editingNoteId]);

  // Sync selection halo from outside.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) =>
        n.selected === (n.id === selectedIssueId) ? n : { ...n, selected: n.id === selectedIssueId },
      ),
    );
  }, [selectedIssueId]);

  const commitNote = useCallback(
    (id: string, patch: { body: string }) => {
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
          onCommit: (patch: { body: string }) => commitNote(n.id, patch),
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
        const next = applyNodeChanges(changes, current);
        // Commit any settled position changes back to data.
        const settled = changes.filter(
          (c): c is Extract<NodeChange, { type: "position" }> => c.type === "position" && c.dragging === false,
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
    [setData],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      const id = shortId("e");
      const edge: WorkingOnEdge = {
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
      if (node.type === "issue") onSelectIssue?.(node.id);
    },
    [onSelectIssue],
  );

  const onPaneClick = useCallback(() => {
    setMenu(null);
    onSelectIssue?.(null);
  }, [onSelectIssue]);

  // Double-click on the empty pane creates a new note. We attach this at the
  // wrapper level (not via onPaneClick) because `selectionOnDrag` makes
  // ReactFlow consume click events for selection start/end, which breaks
  // detail===2 detection on the pane handler.
  const onWrapperDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      const target = evt.target as Element | null;
      if (!target) return;
      // Only proceed when the dblclick lands on the empty pane (not a node, edge,
      // control, minimap, or any of our own overlays).
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
      // Re-grab focus over a few ticks to win the race against ReactFlow's
      // internal pane refocus and StrictMode's double-mount.
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
    },
    [reactFlow, setData],
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
          loading working_on…
        </div>
      )}
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        onNodesChange={onNodesChange}
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
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        preventScrolling
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="rgba(26,24,20,0.08)" />
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
        <WorkingOnContextMenu
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

export default function WorkingOnBoard(props: WorkingOnBoardProps) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}
