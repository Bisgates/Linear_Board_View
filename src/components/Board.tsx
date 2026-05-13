import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import type { IssueRecord } from "../linear/types";
import { computeInitialLayout } from "../lib/layout";
import { loadPositions, pruneOrphans, savePositions, type PositionMap } from "../lib/persistence";
import { SHARED_FLOW_PROPS } from "../lib/boardProps";
import { IssueCard } from "./IssueCard";

const NODE_TYPES: NodeTypes = { issue: IssueCard as unknown as NodeTypes[string] };

function buildNodes(issues: IssueRecord[], positions: PositionMap, initial: PositionMap): Node[] {
  return issues.map((iss) => ({
    id: iss.id,
    type: "issue",
    position: positions[iss.id] ?? initial[iss.id] ?? { x: 0, y: 0 },
    data: iss as unknown as Record<string, unknown>,
    draggable: true,
  }));
}

interface BoardProps {
  issues: IssueRecord[];
  onSelectIssue?: (id: string | null) => void;
  selectedId?: string | null;
}

function buildEdges(issues: IssueRecord[]): Edge[] {
  const ids = new Set(issues.map((i) => i.id));
  const edges: Edge[] = [];
  for (const iss of issues) {
    if (iss.parentId && ids.has(iss.parentId)) {
      edges.push({
        id: `e_${iss.parentId}__${iss.id}`,
        source: iss.parentId,
        target: iss.id,
        type: "smoothstep",
        style: { stroke: "rgba(26,24,20,0.32)", strokeWidth: 1 },
      });
    }
  }
  return edges;
}

function BoardInner({ issues, onSelectIssue, selectedId }: BoardProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edges = useMemo(() => buildEdges(issues), [issues]);

  const onNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      onSelectIssue?.(node.id);
    },
    [onSelectIssue],
  );

  // Mark selected node visually via xyflow's built-in `selected` flag.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => (n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId })),
    );
  }, [selectedId]);

  // Rebuild nodes whenever the issue list changes (e.g., after refresh).
  useEffect(() => {
    if (issues.length === 0) {
      setNodes([]);
      return;
    }
    const initial = computeInitialLayout(issues);
    const stored = loadPositions();
    const validIds = new Set(issues.map((i) => i.id));
    const { kept, discarded } = pruneOrphans(stored, validIds);
    const merged: PositionMap = { ...initial, ...kept };
    if (discarded > 0) savePositions(kept);
    console.log(
      `[persist] hydrated ${Object.keys(kept).length} / discarded ${discarded} orphan(s); rendering ${issues.length} nodes`,
    );
    setNodes(buildNodes(issues, merged, initial));
  }, [issues]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      const settled = changes.some(
        (c) => c.type === "position" && c.dragging === false,
      );
      if (settled) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          const map: PositionMap = {};
          for (const n of next) map[n.id] = { x: n.position.x, y: n.position.y };
          savePositions(map);
          console.log(`[persist] saved ${Object.keys(map).length} positions`);
        }, 200);
      }
      return next;
    });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        nodeTypes={NODE_TYPES}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        {...SHARED_FLOW_PROPS}
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
    </div>
  );
}

export default function Board({ issues, onSelectIssue, selectedId }: BoardProps) {
  return (
    <ReactFlowProvider>
      <BoardInner issues={issues} onSelectIssue={onSelectIssue} selectedId={selectedId} />
    </ReactFlowProvider>
  );
}
