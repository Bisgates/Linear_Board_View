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
  /** Border radius for path corners (defaults to 10) */
  borderRadius?: number;
}

/**
 * Pixel offset from the source's right edge to the X column where every
 * outgoing edge bends down/up toward its target. Using a constant here is
 * what produces the "shared horizontal stem" look in image #8: all edges
 * from the same parent leave the right edge, run together for STEM_OFFSET
 * pixels, then split into vertical branches at the same X.
 *
 * Tuned against tidy's hSpacing=420 with cardW=280 → column gap ≈ 140 px;
 * 64 puts the stem just under half-way into the gap, which reads as a
 * deliberate trunk without being cramped against the parent.
 */
const STEM_OFFSET = 64;

function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sw = source.measured?.width ?? 280;
  const sh = source.measured?.height ?? 120;
  const tw = target.measured?.width ?? 280;
  const th = target.measured?.height ?? 120;
  const spx = source.internals.positionAbsolute.x;
  const spy = source.internals.positionAbsolute.y;
  const tpx = target.internals.positionAbsolute.x;
  const tpy = target.internals.positionAbsolute.y;

  const scy = spy + sh / 2;
  const tcy = tpy + th / 2;

  // Mindmap orientation is left → right: the parent always sits to the LEFT
  // of its children. Always emit Right→Left, even when a child sits well
  // above or below the parent. The previous "dominant-axis" pick would flip
  // to Bottom/Top routing once a sibling drifted past the 45° cone — that's
  // what produced the chaotic mix of right-side AND bottom-side edges
  // leaving the same parent (see image #7 vs the clean stem in image #8).
  //
  // For the rare reverse case (target left of source — manually drawn
  // back-edges), flip to Left→Right so the routing stays sensible.
  const targetIsRight = tpx + tw / 2 >= spx + sw / 2;
  if (targetIsRight) {
    const sx = spx + sw;
    const sy = scy;
    const tx = tpx;
    const ty = tcy;
    // centerX = the shared bend column. With every edge from the same source
    // using the same centerX, getSmoothStepPath draws each one's first leg
    // along the SAME vertical line — they visually merge into one stem.
    const centerX = sx + STEM_OFFSET;
    return {
      sx,
      sy,
      tx,
      ty,
      sourcePos: Position.Right,
      targetPos: Position.Left,
      centerX,
    };
  }
  // target is to the left → flipped (back-edge / cross-link)
  const sx = spx;
  const sy = scy;
  const tx = tpx + tw;
  const ty = tcy;
  const centerX = sx - STEM_OFFSET;
  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos: Position.Left,
    targetPos: Position.Right,
    centerX,
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
  let centerX: number | undefined;
  if (sourceNode && targetNode && sourceNode.measured?.width && targetNode.measured?.width) {
    const p = getEdgeParams(sourceNode, targetNode);
    sx = p.sx;
    sy = p.sy;
    tx = p.tx;
    ty = p.ty;
    sourcePos = p.sourcePos;
    targetPos = p.targetPos;
    centerX = p.centerX;
  }

  // borderRadius softens the corners; the default 10 looks "cared for" — the
  // default 5 reads as too sharp on a 1.6px stroke; bigger than ~14 starts
  // looking bezier-y and loses the circuit-board feel. The value can now be
  // customized per edge style preset via data.borderRadius.
  // centerX makes every edge from the same source share its bend column,
  // which is what produces the visual stem when a parent has many children.
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    borderRadius: data.borderRadius ?? 10,
    centerX,
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
