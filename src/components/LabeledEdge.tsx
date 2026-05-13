import { memo, useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

interface LabeledEdgeData {
  label?: string;
  editing?: boolean;
  onCommit?: (label: string) => void;
  onEditEnd?: () => void;
}

function LabeledEdgeImpl(props: EdgeProps) {
  const data = (props.data ?? {}) as LabeledEdgeData;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });

  const externalEditing = Boolean(data.editing);
  const [editing, setEditing] = useState<boolean>(externalEditing);
  const [text, setText] = useState<string>(data.label ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync external editing flag (entering / leaving from outside, e.g. on dblclick).
  useEffect(() => {
    setEditing(externalEditing);
    if (externalEditing) setText(data.label ?? "");
  }, [externalEditing, data.label]);

  // Refresh display text when not editing.
  useEffect(() => {
    if (!editing) setText(data.label ?? "");
  }, [data.label, editing]);

  // Focus the input on entering edit mode (rAF to survive any focus stealing by ReactFlow's pane).
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
                  // Stop xyflow's global keydown (Delete/Backspace) from chewing on the edge while we type.
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
