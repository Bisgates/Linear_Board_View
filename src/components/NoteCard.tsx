import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from "../lib/workingOn";

interface NoteData {
  id: string;
  body: string;
  color?: string;
  autoEdit?: boolean;
  onCommit?: (patch: { body?: string; color?: string }) => void;
  onEditEnd?: () => void;
}

type Props = NodeProps & { data: NoteData };

function NoteCardImpl({ data, selected }: Props) {
  const [editing, setEditing] = useState<boolean>(Boolean(data.autoEdit));
  const [text, setText] = useState(data.body);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const color = data.color ?? DEFAULT_NOTE_COLOR;
  const handleStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    background: "var(--paper)",
    border: `1.5px solid ${color}`,
  };

  useEffect(() => {
    if (!editing) setText(data.body);
  }, [data.body, editing]);

  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const commit = () => {
    if (text !== data.body) data.onCommit?.({ body: text });
    setEditing(false);
    data.onEditEnd?.();
  };
  const cancel = () => {
    setText(data.body);
    setEditing(false);
    data.onEditEnd?.();
  };

  const lines = data.body.split("\n");
  const titleLine = lines[0] ?? "";
  const restText = lines.slice(1).join("\n");

  return (
    <div
      onDoubleClick={(e) => {
        if (editing) return;
        e.stopPropagation();
        setEditing(true);
      }}
      style={{
        width: 280,
        background: "var(--paper-soft)",
        border: `2px solid ${color}`,
        borderLeft: `6px solid ${color}`,
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: selected
          ? `0 0 0 3px ${color}40, 0 4px 14px rgba(26,24,20,0.12)`
          : "0 1px 0 rgba(26,24,20,0.04)",
        color: "var(--ink)",
        cursor: editing ? "text" : "grab",
        transition: "box-shadow 0.12s",
      }}
    >
      <Handle id="t" type="source" position={Position.Top} style={handleStyle} />
      <Handle id="r" type="source" position={Position.Right} style={handleStyle} />
      <Handle id="b" type="source" position={Position.Bottom} style={handleStyle} />
      <Handle id="l" type="source" position={Position.Left} style={handleStyle} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color,
          marginBottom: 6,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        <span>Note</span>
        <span style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>local</span>
      </div>

      {editing && (
        <div
          className="nodrag nopan"
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 8,
            alignItems: "center",
          }}
        >
          {NOTE_COLORS.map((c) => {
            const active = c === color;
            return (
              <button
                key={c}
                type="button"
                aria-label={`color ${c}`}
                className="nodrag nopan"
                onMouseDown={(e) => {
                  // Keep textarea focused; also stop xyflow's drag start.
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (c !== color) data.onCommit?.({ color: c });
                }}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: c,
                  border: active ? `2px solid var(--ink)` : "1px solid rgba(26,24,20,0.15)",
                  cursor: "pointer",
                  padding: 0,
                  boxShadow: active ? "0 0 0 2px var(--paper-soft)" : "none",
                  transition: "transform 0.1s, box-shadow 0.1s",
                }}
              />
            );
          })}
        </div>
      )}

      {editing ? (
        <textarea
          ref={textRef}
          value={text}
          autoFocus
          data-note-textarea={data.id}
          placeholder="first line is the title…"
          rows={4}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 64,
            border: "1px solid var(--hairline)",
            background: "var(--paper)",
            padding: "6px 8px",
            fontFamily: "var(--sans)",
            fontSize: 13,
            lineHeight: 1.4,
            color: "var(--ink)",
            borderRadius: 4,
            outline: "none",
          }}
        />
      ) : (
        <>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.3,
              marginBottom: restText ? 6 : 0,
              color: titleLine ? "var(--ink)" : "var(--muted)",
              fontStyle: titleLine ? "normal" : "italic",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {titleLine || "untitled (double-click to edit)"}
          </div>
          {restText && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-soft)",
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {restText}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);
