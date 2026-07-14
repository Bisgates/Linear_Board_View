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
  /** Distance from each handle before the first orthogonal bend. */
  offset?: number;
  /** Use rounded orthogonal routing even for graph-mode edges. */
  orthogonal?: boolean;
  /**
   * Growth direction of the tree this edge belongs to. Determines which
   * edge of the parent the stem leaves from and which edge of the child
   * it enters. Missing / "right" = legacy horizontal (parent right →
   * child left).
   */
  direction?: "right" | "left" | "up" | "down";
  /**
   * Graph-mode edge (both endpoints in a flagged connected component — see
   * `lib/graphMode.ts`). Renders as a perpendicular bezier between the
   * dynamically chosen shortest handle pair (CanvasBoard writes sourceHandle
   * / targetHandle on the render-layer edge), skipping the tree-oriented
   * smoothstep routing entirely.
   */
  graph?: boolean;
  /** Manual connection persisted with concrete t/r/b/l handle ids. */
  explicitHandles?: boolean;
}

/** Outward unit normal of a card side, by xyflow handle Position. */
function positionNormal(pos: Position): [number, number] {
  switch (pos) {
    case Position.Top:
      return [0, -1];
    case Position.Right:
      return [1, 0];
    case Position.Bottom:
      return [0, 1];
    case Position.Left:
      return [-1, 0];
  }
}

/**
 * Obsidian-Canvas-style cubic bezier: both control points extend along the
 * OUTWARD NORMAL of the handle's card side, by max(60, distance * 0.4) px —
 * so the line always leaves / enters perpendicular to the card edge with
 * real tension, instead of sagging toward the midpoint like a low-curvature
 * default bezier. Returns [path, labelX, labelY] (label at the curve's
 * t = 0.5 point).
 */
function getPerpendicularBezierPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourcePos: Position,
  targetPos: Position,
): [string, number, number] {
  const dist = Math.hypot(tx - sx, ty - sy);
  const k = Math.max(60, dist * 0.4);
  const [snx, sny] = positionNormal(sourcePos);
  const [tnx, tny] = positionNormal(targetPos);
  const c1x = sx + snx * k;
  const c1y = sy + sny * k;
  const c2x = tx + tnx * k;
  const c2y = ty + tny * k;
  const path = `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
  // Cubic bezier point at t = 0.5: (P0 + 3·P1 + 3·P2 + P3) / 8.
  const labelX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
  const labelY = (sy + 3 * c1y + 3 * c2y + ty) / 8;
  return [path, labelX, labelY];
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

type EdgeDir = "right" | "left" | "up" | "down";

function getEdgeParams(
  source: InternalNode,
  target: InternalNode,
  dir: EdgeDir,
) {
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

  // Mindmap orientation is along the tree's direction: the parent always
  // sits behind its children along the primary axis. Pick the exit / entry
  // edges accordingly. For the rare reverse case (target ends up on the
  // opposite side of the source — e.g. a manually-drawn back-edge), flip
  // the routing so the path stays sensible.
  if (dir === "right" || dir === "left") {
    const targetIsRight = tcx >= scx;
    const forward = dir === "right" ? targetIsRight : !targetIsRight;
    if (forward) {
      // Forward horizontal: source side → target opposite side.
      const sx = dir === "right" ? spx + sw : spx; // right edge or left edge
      const sy = scy;
      const tx = dir === "right" ? tpx : tpx + tw;
      const ty = tcy;
      const centerX = dir === "right" ? sx + STEM_OFFSET : sx - STEM_OFFSET;
      return {
        sx,
        sy,
        tx,
        ty,
        sourcePos: dir === "right" ? Position.Right : Position.Left,
        targetPos: dir === "right" ? Position.Left : Position.Right,
        centerX,
        centerY: undefined,
      };
    }
    // Back-edge: flip sides.
    const sx = dir === "right" ? spx : spx + sw;
    const sy = scy;
    const tx = dir === "right" ? tpx + tw : tpx;
    const ty = tcy;
    const centerX = dir === "right" ? sx - STEM_OFFSET : sx + STEM_OFFSET;
    return {
      sx,
      sy,
      tx,
      ty,
      sourcePos: dir === "right" ? Position.Left : Position.Right,
      targetPos: dir === "right" ? Position.Right : Position.Left,
      centerX,
      centerY: undefined,
    };
  }
  // Vertical tree (up / down).
  const targetIsBelow = tcy >= scy;
  const forward = dir === "down" ? targetIsBelow : !targetIsBelow;
  if (forward) {
    const sx = scx;
    const sy = dir === "down" ? spy + sh : spy; // bottom or top edge
    const tx = tcx;
    const ty = dir === "down" ? tpy : tpy + th;
    const centerY = dir === "down" ? sy + STEM_OFFSET : sy - STEM_OFFSET;
    return {
      sx,
      sy,
      tx,
      ty,
      sourcePos: dir === "down" ? Position.Bottom : Position.Top,
      targetPos: dir === "down" ? Position.Top : Position.Bottom,
      centerX: undefined,
      centerY,
    };
  }
  // Back-edge for a vertical tree.
  const sx = scx;
  const sy = dir === "down" ? spy : spy + sh;
  const tx = tcx;
  const ty = dir === "down" ? tpy + th : tpy;
  const centerY = dir === "down" ? sy - STEM_OFFSET : sy + STEM_OFFSET;
  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos: dir === "down" ? Position.Top : Position.Bottom,
    targetPos: dir === "down" ? Position.Bottom : Position.Top,
    centerX: undefined,
    centerY,
  };
}

function LabeledEdgeImpl(props: EdgeProps) {
  const data = (props.data ?? {}) as LabeledEdgeData;
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);

  // Floating-edge: derive endpoints from current node bboxes. Re-renders on
  // drag because useInternalNode subscribes to position changes. Fall back to
  // xyflow's handle-derived props on the first frame when measure isn't ready.
  const isGraph = Boolean(data.graph);
  const hasExplicitHandles = Boolean(
    data.explicitHandles || props.sourceHandleId || props.targetHandleId,
  );

  let sx = props.sourceX;
  let sy = props.sourceY;
  let tx = props.targetX;
  let ty = props.targetY;
  let sourcePos = props.sourcePosition;
  let targetPos = props.targetPosition;
  let centerX: number | undefined;
  let centerY: number | undefined;
  const dir: EdgeDir = (data.direction as EdgeDir | undefined) ?? "right";
  if (
    !isGraph &&
    !hasExplicitHandles &&
    sourceNode &&
    targetNode &&
    sourceNode.measured?.width &&
    targetNode.measured?.width
  ) {
    const p = getEdgeParams(sourceNode, targetNode, dir);
    sx = p.sx;
    sy = p.sy;
    tx = p.tx;
    ty = p.ty;
    sourcePos = p.sourcePos;
    targetPos = p.targetPos;
    centerX = p.centerX;
    centerY = p.centerY;
  }

  // Graph edges: drawn between the handle-derived endpoints (the shortest
  // 4×4 pair chosen by CanvasBoard's edge assembly — props.sourceX/Y already
  // reflect the assigned sourceHandle/targetHandle). The perpendicular
  // bezier won the candidate bake-off (vs straight / rounded-step / soft
  // bezier) — it leaves the card edge at a right angle with real tension.
  //
  // Auto tree edges retain root-direction routing and a shared bend column.
  // Explicit tree edges use xyflow's handle-derived props directly, so a line
  // drawn from `t` to `r` stays attached to those exact sides after moves and
  // resizes while still receiving the same rounded smooth-step treatment.
  let path: string;
  let labelX: number;
  let labelY: number;
  if (isGraph && !data.orthogonal) {
    [path, labelX, labelY] = getPerpendicularBezierPath(sx, sy, tx, ty, sourcePos, targetPos);
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      borderRadius: data.borderRadius ?? 10,
      offset: data.offset ?? 20,
      centerX,
      centerY,
    });
  }

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
