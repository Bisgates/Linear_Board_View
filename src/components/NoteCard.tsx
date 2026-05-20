import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DEFAULT_NOTE_COLOR, openLocalPath } from "../lib/workingOn";

// Fixed wiki-link blue, deliberately *not* tied to the per-note accent or any
// CSS theme variable. Wiki references are a global cross-card feature, so
// they read consistently regardless of which colored note they sit inside.
// Picked at the soft end of "Notion / Bear / Roam" link blue — bright enough
// to read on the warm cream paper, muted enough not to fight the body ink.
const WIKI_LINK_COLOR = "#5b8def";

// Match four things in one pass so spans never overlap and ordering is
// preserved by `lastIndex`:
//   1. `[[YYMMDDxx]]` — wiki-style internal card link (strict shape).
//   2. http(s):// URLs.
//   3. Absolute Mac / Linux file paths under common roots.
//   4. `![](<filename>)` — markdown image ref pointing at a file in
//      `<data>/images/`; rendered inline as a block-level `<img>` whose
//      bytes are served via the `imgref://` Tauri URI scheme.
// Each branch is captured separately so the renderer can dispatch by which
// group matched without re-parsing the matched text. URL / path branches stop
// at whitespace and common trailing punctuation so a URL in parens or a path
// followed by a comma still parse cleanly.
const TOKEN_REGEX =
  /(\[\[[0-9]{6}[a-z]{2}\]\])|(https?:\/\/[^\s)\]}>]+)|(\/(?:Users|Volumes|tmp|var|opt|Applications|Library|home|private|etc)\/[^\s)\]}>]+)|(!\[\]\(([A-Za-z0-9]+\.(?:jpg|jpeg|png|webp))\))/g;

interface RenderTokensOpts {
  /** Brand-stable accent for normal links / valid card refs. */
  accent: string;
  /** Resolves a card link to its current node id, or null if the link is broken
   *  (target deleted, or doesn't exist on the active board). */
  resolveCardLink?: (cardId: string) => string | null;
  /** Click handler for valid card links. Receives the *node* id, not the cardId. */
  onJumpToCardNode?: (nodeId: string) => void;
  /** Max display width (px) for inline images — caps to the card's inner content area. */
  imageMaxW: number;
}

function renderTokens(text: string, opts: RenderTokensOpts): ReactNode[] {
  const { accent, resolveCardLink, onJumpToCardNode, imageMaxW } = opts;
  const tokens: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_REGEX.exec(text)) !== null) {
    if (m.index > lastIdx) tokens.push(text.slice(lastIdx, m.index));
    const matched = m[0];
    const isCardLink = m[1] !== undefined;
    const isUrl = m[2] !== undefined;
    const isPath = m[3] !== undefined;
    const isImage = m[4] !== undefined;

    if (isCardLink) {
      // Wiki link `[[YYMMDDxx]]` — render as a chip-style click target.
      const cardId = matched.slice(2, -2);
      const targetNodeId = resolveCardLink ? resolveCardLink(cardId) : null;
      const found = targetNodeId !== null;
      const baseColor = found ? WIKI_LINK_COLOR : "var(--warm-red)";
      const style: React.CSSProperties = {
        color: baseColor,
        textDecoration: "none",
        cursor: found ? "pointer" : "not-allowed",
        padding: "0 2px",
        borderRadius: 3,
        transition: "background-color 0.1s",
        opacity: found ? 1 : 0.85,
      };
      tokens.push(
        <a
          key={key++}
          className="nodrag nopan"
          href="#"
          title={found ? `jump to ${cardId}` : `broken link — no card with id ${cardId} on this board`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (found && targetNodeId && onJumpToCardNode) onJumpToCardNode(targetNodeId);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            const tint =
              baseColor.startsWith("#") && baseColor.length === 7
                ? `${baseColor}1f`
                : "rgba(178,58,72,0.10)";
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor = tint;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
          }}
          style={style}
        >
          {matched}
        </a>,
      );
    } else if (isUrl) {
      const linkStyle: React.CSSProperties = {
        color: accent,
        textDecoration: "underline",
        cursor: "pointer",
        wordBreak: "break-all",
      };
      tokens.push(
        <a
          key={key++}
          className="nodrag nopan"
          href={matched}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={linkStyle}
        >
          {matched}
        </a>,
      );
    } else if (isPath) {
      const linkStyle: React.CSSProperties = {
        color: accent,
        textDecoration: "underline",
        cursor: "pointer",
        wordBreak: "break-all",
      };
      tokens.push(
        <a
          key={key++}
          className="nodrag nopan"
          href="#"
          title={`open ${matched}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void openLocalPath(matched);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          style={linkStyle}
        >
          {matched}
        </a>,
      );
    } else if (isImage) {
      // Embedded image — `m[5]` is the inner filename capture. Served by the
      // custom `imgref://` scheme registered in `src-tauri/src/lib.rs`. `display:
      // block` so it naturally breaks the inline flow even when the markdown
      // sits in the middle of a paragraph.
      const filename = m[5];
      tokens.push(
        <img
          key={key++}
          src={`imgref://localhost/${filename}`}
          alt=""
          draggable={false}
          style={{
            display: "block",
            width: "100%",
            maxWidth: imageMaxW,
            height: "auto",
            objectFit: "contain",
            borderRadius: 4,
            margin: "6px 0",
            userSelect: "none",
          }}
        />,
      );
    }
    lastIdx = m.index + matched.length;
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
  /** This card's wiki-style id (`YYMMDDxx`); empty until migration runs. */
  cardId?: string;
  onCommit?: (patch: {
    body?: string;
    color?: string;
    working?: boolean;
    done?: boolean;
  }) => void;
  onEditEnd?: () => void;
  /** Resolves a `[[cardId]]` reference to the corresponding xyflow node id on
   *  the active board, or null if no such card exists. */
  resolveCardLink?: (cardId: string) => string | null;
  /** Pan to the named node id while preserving the current zoom level. */
  onJumpToCardNode?: (nodeId: string) => void;
}

// When a note is marked done, swap the saturated accent for a muted gray so the
// card visibly recedes on the board (Apple Reminders / Things style). Hue is
// defined per palette in src/index.css.
const DONE_FRAME_COLOR = "var(--note-done)";
// "Working on" indicator color — defined per palette so it stays in step with
// the paper hue. Distinct from any user-pickable swatch in `NOTE_COLORS`.
const WORKING_COLOR = "var(--note-working)";

// Fixed card width; image display caps to the inner content area below.
const CARD_W = 280;
// Inner padding 12px each side = 24 lateral, frame stripe 6+2 = 8 horizontal.
// Inline images get capped to this so they never spill past the card edge.
const IMAGE_MAX_W = CARD_W - 8 - 24;

type Props = NodeProps & { data: NoteData };

function NoteCardImpl({ data, selected }: Props) {
  const [editing, setEditing] = useState<boolean>(Boolean(data.autoEdit));
  const [draftBody, setDraftBody] = useState<string>(data.body ?? "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Sync local draft from external data when not editing (server-authoritative
  // replace, undo/redo, paste appending image refs from CanvasBoard, etc.).
  useEffect(() => {
    if (!editing) setDraftBody(data.body ?? "");
  }, [data.body, editing]);

  // External edit command from CanvasBoard (driven by editingNoteId): Space
  // on a focused note sets autoEdit → enter edit; mind-map Esc clears it →
  // exit edit. Local dblclick edits flip `editing` without touching autoEdit,
  // so this effect only fires on true external transitions.
  useEffect(() => {
    setEditing(Boolean(data.autoEdit));
  }, [data.autoEdit]);

  // On entering edit: focus the textarea and place the cursor at the end so
  // users can keep typing where they left off.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // Autogrow the textarea so long notes expand the card instead of scrolling
  // internally. Re-run whenever the draft text changes.
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draftBody]);

  const commit = () => {
    const prev = data.body ?? "";
    if (draftBody !== prev) data.onCommit?.({ body: draftBody });
    setEditing(false);
    data.onEditEnd?.();
  };
  const cancel = () => {
    setDraftBody(data.body ?? "");
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

  // View-mode body: split by `\n` and render each line — `renderTokens` turns
  // any `![](...)` token inside a line into a block-level `<img>`, so a line
  // that's just an image ref produces a clean inline picture without any
  // surrounding text noise.
  const lines = (data.body ?? "").split("\n");
  // A line is treated as the "title" only if it sits before any non-empty
  // content. Pure image refs (`![](...)` only) don't count as a title even
  // though they're on line 0 — that way a paste-an-image-first card doesn't
  // stamp its filename-looking ref in bold.
  const firstTextLineIdx = (() => {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = (lines[i] ?? "").trim();
      if (!trimmed) continue;
      // Pure image-ref line → not a title candidate.
      if (/^!\[\]\([A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)\)$/.test(trimmed)) continue;
      return i;
    }
    return -1;
  })();
  const hasAnyContent = (data.body ?? "").trim().length > 0;

  return (
    <div
      onDoubleClick={(e) => {
        if (editing) return;
        e.stopPropagation();
        setEditing(true);
      }}
      onContextMenu={(e) => {
        // Right-click in editing mode goes to the textarea so the browser's
        // native menu (spellcheck, paste, etc.) still works. Otherwise we
        // let the event bubble up to xyflow's `onNodeContextMenu` in
        // CanvasBoard, which builds the per-target menu (Copy ID + Delete).
        if (editing) e.stopPropagation();
      }}
      style={{
        width: CARD_W,
        // The outer block is the color "frame" itself; the inner paper card
        // sits inside with concentric corner radii so the left stripe + top /
        // right / bottom border curve smoothly into each other (Apple HIG —
        // nested rounded rects use concentric, not stacked, corners).
        background: color,
        padding: "2px 2px 2px 6px",
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent), 0 4px 14px rgba(0,0,0,0.14)`
          : "0 1px 0 rgba(0,0,0,0.04)",
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
          position: "relative",
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
          {/* Image-only notes (body has only `![](...)` tokens, no real text)
              skip the "Note" label so a paste-an-image card looks like a clean
              picture, not a NOTE-stamped placeholder. */}
          <span style={{ opacity: firstTextLineIdx >= 0 ? 1 : 0 }}>Note</span>
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
              ...(status === "todo" && {
                border: "1px solid rgba(26,24,20,0.22)",
                background: "var(--paper)",
                boxShadow:
                  "inset 0 1px 1.5px rgba(26,24,20,0.07), inset 0 0 0 0.5px rgba(255,255,255,0.5)",
              }),
              ...(status === "working" && {
                border: `1.5px solid ${WORKING_COLOR}`,
                background: "var(--paper)",
                boxShadow: `inset 0 0 6px 2px color-mix(in srgb, ${WORKING_COLOR} 60%, transparent)`,
              }),
              ...(status === "done" && {
                border: `1px solid ${color}`,
                background: color,
                boxShadow: "0 1px 0 rgba(26,24,20,0.06)",
              }),
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.14s, border-color 0.14s, box-shadow 0.14s",
            }}
          >
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
          <textarea
            ref={textareaRef}
            value={draftBody}
            data-note-textarea={data.id}
            rows={1}
            placeholder="first line is the title…"
            className="nodrag nopan"
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={sharedKeys}
            onBlur={commit}
            style={{
              width: "100%",
              resize: "none",
              border: "none",
              background: "transparent",
              padding: 0,
              fontFamily: "var(--sans)",
              fontSize: 13,
              lineHeight: 1.4,
              color: "var(--ink-soft)",
              outline: "none",
              display: "block",
              overflow: "hidden",
            }}
          />
        ) : !hasAnyContent ? (
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "var(--muted)",
              fontStyle: "italic",
            }}
          >
            untitled (double-click to edit)
          </div>
        ) : (
          <div>
            {lines.map((line, idx) => {
              const isTitleLine = idx === firstTextLineIdx;
              // Treat a "pure image ref" line as a block element with no extra
              // wrapping text styles — the `<img>` from renderTokens carries
              // its own margin. Other lines get title / body typography.
              const isPureImageLine = /^!\[\]\([A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)\)$/.test(
                line.trim(),
              );
              const baseStyle: React.CSSProperties = isTitleLine
                ? {
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    color: done ? "var(--muted)" : "var(--ink)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    textDecoration: done ? "line-through" : "none",
                    textDecorationColor: done ? "var(--muted)" : undefined,
                    textDecorationThickness: done ? "1.5px" : undefined,
                  }
                : {
                    fontSize: 12,
                    color: done ? "var(--muted)" : "var(--ink-soft)",
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    textDecoration: done ? "line-through" : "none",
                    textDecorationColor: done ? "var(--muted)" : undefined,
                  };
              if (isPureImageLine) {
                return (
                  <div key={idx}>
                    {renderTokens(line, {
                      accent: color,
                      resolveCardLink: data.resolveCardLink,
                      onJumpToCardNode: data.onJumpToCardNode,
                      imageMaxW: IMAGE_MAX_W,
                    })}
                  </div>
                );
              }
              return (
                <div key={idx} style={baseStyle}>
                  {line
                    ? renderTokens(line, {
                        accent: color,
                        resolveCardLink: data.resolveCardLink,
                        onJumpToCardNode: data.onJumpToCardNode,
                        imageMaxW: IMAGE_MAX_W,
                      })
                    : " "}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);
