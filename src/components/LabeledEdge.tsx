import { memo, useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

interface LabeledEdgeData {
  label?: string;
  editing?: boolean;
  onCommit?: (label: string) => void;
  onEditEnd?: () => void;
}

function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sw = source.measured?.width ?? 280;
  const sh = source.measured?.height ?? 120;
  const tw = target.measured?.width ?? 280;
  const th = target.measured?.height ?? 120;
  const spx = source.internals.positionAbsolute.x;
  const spy = source.internals.positionAbsolute.y;
  const tpx = target.internals.positionAbsolute.x;
  const tpy = target.internals.positionAbsolute.y;

  const scx = spx + sw / 2;
  const scy = spy + sh / 2;
  const tcx = tpx + tw / 2;
  const tcy = tpy + th / 2;

  const dx = tcx - scx;
  const dy = tcy - scy;

  // Dominant-axis pick — yields a single-turn smoothstep when nodes are roughly
  // aligned, Z-shape otherwise. Always re-evaluates on node move because
  // useInternalNode below subscribes to position changes.
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return {
        sx: spx + sw,
        sy: scy,
        tx: tpx,
        ty: tcy,
        sourcePos: Position.Right,
        targetPos: Position.Left,
      };
    }
    return {
      sx: spx,
      sy: scy,
      tx: tpx + tw,
      ty: tcy,
      sourcePos: Position.Left,
      targetPos: Position.Right,
    };
  }
  if (dy >= 0) {
    return {
      sx: scx,
      sy: spy + sh,
      tx: tcx,
      ty: tpy,
      sourcePos: Position.Bottom,
      targetPos: Position.Top,
    };
  }
  return {
    sx: scx,
    sy: spy,
    tx: tcx,
    ty: tpy + th,
    sourcePos: Position.Top,
    targetPos: Position.Bottom,
  };
}

function LabeledEdgeImpl(props: EdgeProps) {
  const data = (props.data ?? {}) as LabeledEdgeData;
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);

  // Floating-edge: derive endpoints from current node bboxes. Re-renders on
  // drag because useInternalNode subscribes to position changes. Fall back to
  // xyflow's handle-derived props on the first frame when measure isn't ready.
  let sx = props.sourceX;
  let sy = props.sourceY;
  let tx = props.targetX;
  let ty = props.targetY;
  let sourcePos = props.sourcePosition;
  let targetPos = props.targetPosition;
  if (sourceNode && targetNode && sourceNode.measured?.width && targetNode.measured?.width) {
    const p = getEdgeParams(sourceNode, targetNode);
    sx = p.sx;
    sy = p.sy;
    tx = p.tx;
    ty = p.ty;
    sourcePos = p.sourcePos;
    targetPos = p.targetPos;
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
  });

  const externalEditing = Boolean(data.editing);
  const [editing, setEditing] = useState<boolean>(externalEditing);
  const [text, setText] = useState<string>(data.label ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEditing(externalEditing);
    if (externalEditing) setText(data.label ?? "");
  }, [externalEditing, data.label]);

  useEffect(() => {
    if (!editing) setText(data.label ?? "");
  }, [data.label, editing]);

  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const commit = () => {
    if (text !== (data.label ?? "")) data.onCommit?.(text);
    setEditing(false);
    data.onEditEnd?.();
  };
  const cancel = () => {
    setText(data.label ?? "");
    setEditing(false);
    data.onEditEnd?.();
  };

  const hasLabel = editing || (data.label ?? "").length > 0;

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!editing) setEditing(true);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              background: "var(--paper)",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: editing ? 0 : "2px 8px",
              fontSize: 11,
              color: "var(--ink)",
              fontFamily: "var(--sans)",
              boxShadow: "0 1px 0 rgba(26,24,20,0.06)",
              maxWidth: 220,
              cursor: editing ? "text" : "pointer",
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                  e.stopPropagation();
                }}
                onBlur={commit}
                placeholder="label…"
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "2px 8px",
                  fontSize: 11,
                  color: "var(--ink)",
                  fontFamily: "var(--sans)",
                  outline: "none",
                  width: 160,
                }}
              />
            ) : (
              <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{data.label}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const LabeledEdge = memo(LabeledEdgeImpl);
