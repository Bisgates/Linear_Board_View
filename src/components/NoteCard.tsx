import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DEFAULT_NOTE_COLOR, openLocalPath } from "../lib/workingOn";

// Match http(s) URLs and absolute Mac / Linux file paths (common roots only).
// Stops at whitespace and common trailing punctuation so a URL in parens or a
// path followed by a comma still parses cleanly.
const LINK_REGEX =
  /(https?:\/\/[^\s)\]}>]+|\/(?:Users|Volumes|tmp|var|opt|Applications|Library|home|private|etc)\/[^\s)\]}>]+)/g;

function renderTokens(text: string, accent: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  LINK_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_REGEX.exec(text)) !== null) {
    if (m.index > lastIdx) tokens.push(text.slice(lastIdx, m.index));
    const link = m[0];
    const linkStyle: React.CSSProperties = {
      color: accent,
      textDecoration: "underline",
      cursor: "pointer",
      wordBreak: "break-all",
    };
    if (link.startsWith("http")) {
      tokens.push(
        <a
          key={key++}
          className="nodrag nopan"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={linkStyle}
        >
          {link}
        </a>,
      );
    } else {
      tokens.push(
        <a
          key={key++}
          className="nodrag nopan"
          href="#"
          title={`open ${link}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void openLocalPath(link);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          style={linkStyle}
        >
          {link}
        </a>,
      );
    }
    lastIdx = m.index + link.length;
  }
  if (lastIdx < text.length) tokens.push(text.slice(lastIdx));
  return tokens;
}

interface NoteData {
  id: string;
  body: string;
  color?: string;
  working?: boolean;
  done?: boolean;
  autoEdit?: boolean;
  onCommit?: (patch: { body?: string; color?: string; working?: boolean; done?: boolean }) => void;
  onEditEnd?: () => void;
}

// When a note is marked done, swap the saturated accent for a muted gray so the
// card visibly recedes on the board (Apple Reminders / Things style).
const DONE_FRAME_COLOR = "#a8a39a";
// "Working on" indicator color — a slightly-muted vivid blue that fits the
// warm-paper palette but reads clearly distinct from the slate blue swatch in
// `NOTE_COLORS` (which is user-pickable as a card frame color).
const WORKING_COLOR = "#3b6fb8";

type Props = NodeProps & { data: NoteData };

function NoteCardImpl({ data, selected }: Props) {
  const [editing, setEditing] = useState<boolean>(Boolean(data.autoEdit));
  const splitBody = (b: string): { title: string; rest: string } => {
    const ls = b.split("\n");
    return { title: ls[0] ?? "", rest: ls.slice(1).join("\n") };
  };
  const initial = splitBody(data.body);
  const [title, setTitle] = useState(initial.title);
  const [rest, setRest] = useState(initial.rest);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const restRef = useRef<HTMLTextAreaElement | null>(null);

  const accent = data.color ?? DEFAULT_NOTE_COLOR;
  const done = Boolean(data.done);
  const working = !done && Boolean(data.working);
  const status: "todo" | "working" | "done" = done ? "done" : working ? "working" : "todo";
  // The card frame still recedes to gray only when done — "working on" keeps
  // the user's chosen accent so an in-progress card stays visually full color.
  const color = done ? DONE_FRAME_COLOR : accent;
  const handleStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    background: "var(--paper)",
    border: `1.5px solid ${color}`,
  };

  // Sync local state from external data.body when not editing (e.g. after a
  // server-authoritative replace). During editing we hold the user's draft.
  useEffect(() => {
    if (!editing) {
      const s = splitBody(data.body);
      setTitle(s.title);
      setRest(s.rest);
    }
  }, [data.body, editing]);

  // External edit command from CanvasBoard (driven by editingNoteId): Space
  // on a focused note sets autoEdit → enter edit; mind-map Esc clears it →
  // exit edit. Local dblclick edits flip `editing` without touching autoEdit,
  // so this effect only fires on true external transitions.
  useEffect(() => {
    setEditing(Boolean(data.autoEdit));
  }, [data.autoEdit]);

  // On entering edit: focus end of whichever field has content. Empty notes
  // → title; notes with body → body (matches the old single-textarea "end of
  // all content" behavior).
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const el = rest ? restRef.current : titleRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // Autogrow the body textarea so long notes expand the card instead of
  // scrolling internally. Run whenever content changes or edit mode opens.
  useEffect(() => {
    if (!editing) return;
    const el = restRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, rest]);

  const commit = () => {
    const joined = rest ? `${title}\n${rest}` : title;
    if (joined !== data.body) data.onCommit?.({ body: joined });
    setEditing(false);
    data.onEditEnd?.();
  };
  // Commit on blur only when focus leaves *both* fields (Tab between them
  // shouldn't close the editor). Defer to next frame so the new focus target
  // is already set.
  const onFieldBlur = () => {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a === titleRef.current || a === restRef.current) return;
      commit();
    });
  };
  const cancel = () => {
    const s = splitBody(data.body);
    setTitle(s.title);
    setRest(s.rest);
    setEditing(false);
    data.onEditEnd?.();
  };

  const sharedKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  const titleLine = title;
  const restText = rest;

  return (
    <div
      onDoubleClick={(e) => {
        if (editing) return;
        e.stopPropagation();
        setEditing(true);
      }}
      style={{
        width: 280,
        // The outer block is the color "frame" itself; the inner paper card
        // sits inside with concentric corner radii so the left stripe + top /
        // right / bottom border curve smoothly into each other (Apple HIG —
        // nested rounded rects use concentric, not stacked, corners).
        background: color,
        padding: "2px 2px 2px 6px",
        borderRadius: 10,
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
          background: done ? "var(--paper-deep)" : "var(--paper-soft)",
          // Concentric radii: outer 10 − left offset 6 = 4 for left corners;
          // outer 10 − top/right/bottom offset 2 = 8 for the others.
          borderRadius: "4px 8px 8px 4px",
          padding: "10px 12px",
        }}
      >
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
          gap: 8,
        }}
      >
        <span>Note</span>
        <button
          type="button"
          role="checkbox"
          aria-checked={done ? true : working ? "mixed" : false}
          aria-label={
            status === "todo"
              ? "mark as working on"
              : status === "working"
                ? "mark as done"
                : "mark as todo"
          }
          className="nodrag nopan"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            // Three-state cycle: todo → working → done → todo.
            if (status === "todo") data.onCommit?.({ working: true, done: false });
            else if (status === "working") data.onCommit?.({ working: false, done: true });
            else data.onCommit?.({ working: false, done: false });
          }}
          style={{
            width: 15,
            height: 15,
            borderRadius: 4,
            // Three states: todo = hairline empty paper (stamped-in look);
            // working = filled WORKING_COLOR with a centered white bar
            // (Things 3 "in-progress" affordance); done = filled with the
            // frame color and a bold tilted check.
            border:
              status === "todo"
                ? "1px solid rgba(26,24,20,0.22)"
                : status === "working"
                  ? `1px solid ${WORKING_COLOR}`
                  : `1px solid ${color}`,
            background:
              status === "todo"
                ? "var(--paper)"
                : status === "working"
                  ? WORKING_COLOR
                  : color,
            boxShadow:
              status === "todo"
                ? "inset 0 1px 1.5px rgba(26,24,20,0.07), inset 0 0 0 0.5px rgba(255,255,255,0.5)"
                : "0 1px 0 rgba(26,24,20,0.06)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.14s, border-color 0.14s, box-shadow 0.14s",
          }}
        >
          {status === "working" && (
            <span
              style={{
                display: "block",
                width: 7,
                height: 2,
                borderRadius: 1,
                background: "var(--paper)",
              }}
            />
          )}
          {status === "done" && (
            <svg
              width={11}
              height={11}
              viewBox="0 0 10 10"
              fill="none"
              stroke="var(--paper)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: "rotate(-6deg)" }}
            >
              <polyline points="1.5,5.2 4,7.5 8.5,2.4" />
            </svg>
          )}
        </button>
      </div>

      {editing ? (
        <>
          <input
            ref={titleRef}
            value={title}
            data-note-textarea={rest ? undefined : data.id}
            placeholder="first line is the title…"
            className="nodrag nopan"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                // Move focus to body textarea — matches old "newline goes to
                // the next line of the body" behavior in the single-textarea
                // version.
                e.preventDefault();
                const el = restRef.current;
                if (el) {
                  el.focus();
                  el.setSelectionRange(0, 0);
                }
              } else {
                sharedKeys(e);
              }
            }}
            onBlur={onFieldBlur}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              padding: 0,
              fontFamily: "var(--sans)",
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "var(--ink)",
              outline: "none",
              display: "block",
              marginBottom: rest ? 6 : 0,
            }}
          />
          <textarea
            ref={restRef}
            value={rest}
            data-note-textarea={rest ? data.id : undefined}
            rows={1}
            className="nodrag nopan"
            onChange={(e) => setRest(e.target.value)}
            onKeyDown={sharedKeys}
            onBlur={onFieldBlur}
            style={{
              width: "100%",
              resize: "none",
              border: "none",
              background: "transparent",
              padding: 0,
              fontFamily: "var(--sans)",
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--ink-soft)",
              outline: "none",
              display: "block",
              overflow: "hidden",
            }}
          />
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.3,
              marginBottom: restText ? 6 : 0,
              color: done ? "var(--muted)" : titleLine ? "var(--ink)" : "var(--muted)",
              fontStyle: titleLine ? "normal" : "italic",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textDecoration: done ? "line-through" : "none",
              textDecorationColor: done ? "var(--muted)" : undefined,
              textDecorationThickness: done ? "1.5px" : undefined,
            }}
          >
            {titleLine ? renderTokens(titleLine, color) : "untitled (double-click to edit)"}
          </div>
          {restText && (
            <div
              style={{
                fontSize: 12,
                color: done ? "var(--muted)" : "var(--ink-soft)",
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                textDecoration: done ? "line-through" : "none",
                textDecorationColor: done ? "var(--muted)" : undefined,
              }}
            >
              {renderTokens(restText, color)}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);
