import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DEFAULT_NOTE_COLOR, openLocalPath, type NoteImage } from "../lib/workingOn";

// Fixed wiki-link blue, deliberately *not* tied to the per-note accent or any
// CSS theme variable. Wiki references are a global cross-card feature, so
// they read consistently regardless of which colored note they sit inside.
// Picked at the soft end of "Notion / Bear / Roam" link blue — bright enough
// to read on the warm cream paper, muted enough not to fight the body ink.
const WIKI_LINK_COLOR = "#5b8def";

// Match three things in one pass so spans never overlap and ordering is
// preserved by `lastIndex`:
//   1. `[[YYMMDDxx]]` — wiki-style internal card link (strict shape).
//   2. http(s):// URLs.
//   3. Absolute Mac / Linux file paths under common roots.
// Each branch is captured separately so the renderer can dispatch by which
// group matched without re-parsing the matched text. URL / path branches stop
// at whitespace and common trailing punctuation so a URL in parens or a path
// followed by a comma still parse cleanly.
const TOKEN_REGEX =
  /(\[\[[0-9]{6}[a-z]{2}\]\])|(https?:\/\/[^\s)\]}>]+)|(\/(?:Users|Volumes|tmp|var|opt|Applications|Library|home|private|etc)\/[^\s)\]}>]+)/g;

interface RenderTokensOpts {
  /** Brand-stable accent for normal links / valid card refs. */
  accent: string;
  /** Resolves a card link to its current node id, or null if the link is broken
   *  (target deleted, or doesn't exist on the active board). */
  resolveCardLink?: (cardId: string) => string | null;
  /** Click handler for valid card links. Receives the *node* id, not the cardId. */
  onJumpToCardNode?: (nodeId: string) => void;
}

function renderTokens(text: string, opts: RenderTokensOpts): ReactNode[] {
  const { accent, resolveCardLink, onJumpToCardNode } = opts;
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

    if (isCardLink) {
      // Wiki link `[[YYMMDDxx]]` — render as a chip-style click target. No
      // underline (per user request); a fixed wiki-link blue (Notion / Bear
      // / Roam adjacent) carries the "this is a link" signal, *not* the
      // per-note accent — wiki references are a global feature, so they
      // shouldn't recolor with the card's frame swatch. Font-family +
      // font-size inherit from surrounding body text. Hover lights the chip
      // with the same blue at ~12% alpha.
      // Broken / cross-board targets share the chip shape but in warm-red
      // with a `not-allowed` cursor.
      const cardId = matched.slice(2, -2);
      const targetNodeId = resolveCardLink ? resolveCardLink(cardId) : null;
      const found = targetNodeId !== null;
      // `WIKI_LINK_COLOR` defined at module scope above the renderer.
      const baseColor = found ? WIKI_LINK_COLOR : "var(--warm-red)";
      const style: React.CSSProperties = {
        color: baseColor,
        textDecoration: "none",
        cursor: found ? "pointer" : "not-allowed",
        // Tight chip padding so hover bg has somewhere to render without
        // visibly expanding the inline line height.
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
            // `${color}1f` ≈ 12% alpha when the color is a 6-digit hex
            // (matches both WIKI_LINK_COLOR and most note-accent swatches).
            // CSS variables (warm-red for broken links) fall back to a
            // fixed warm-red overlay so the chip still highlights visibly.
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
    } else {
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
  images?: NoteImage[];
  textSegments?: string[];
  /** This card's wiki-style id (`YYMMDDxx`); empty until migration runs. */
  cardId?: string;
  onCommit?: (patch: {
    body?: string;
    color?: string;
    working?: boolean;
    done?: boolean;
    images?: NoteImage[];
    textSegments?: string[];
  }) => void;
  onEditEnd?: () => void;
  /** Resolves a `[[cardId]]` reference to the corresponding xyflow node id on
   *  the active board, or null if no such card exists. */
  resolveCardLink?: (cardId: string) => string | null;
  /** Pan to the named node id while preserving the current zoom level. */
  onJumpToCardNode?: (nodeId: string) => void;
}

/**
 * Compute the segment list from a NoteData. textSegments[i] sits before
 * images[i]; segments.length is always images.length + 1. Old notes that
 * pre-date this field migrate as `[body, '', '', ...]` — text first, empty
 * trailing slots between/after images so the user can immediately start
 * typing below any image.
 */
function deriveSegments(data: NoteData): string[] {
  const imgs = data.images ?? [];
  const stored = data.textSegments;
  if (Array.isArray(stored) && stored.length === imgs.length + 1) return stored.slice();
  const body = data.body ?? "";
  if (imgs.length === 0) return [body];
  const out = new Array(imgs.length + 1).fill("");
  out[0] = body;
  return out;
}

function segmentsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Resize bounds for embedded note images.
const IMG_MIN = 40;
const IMG_MAX = 1200;

type Corner = "tl" | "tr" | "bl" | "br";

interface NoteImageViewProps {
  image: NoteImage;
  showHandles: boolean;
  accent: string;
  // Render-time width cap. Card is fixed-width, so any stored width above this
  // is squeezed down on display, preserving aspect via `dh` below. Resize
  // drags also clamp to this so the user can't grow the image past the card.
  maxW: number;
  onChange: (next: NoteImage) => void;
  onDelete: () => void;
}

/**
 * Single embedded image with 4-corner resize handles. Handles only paint when
 * `showHandles` is true (i.e. the parent NoteCard is currently selected).
 * Shift during drag locks the original aspect ratio; default is free resize.
 */
function NoteImageView({ image, showHandles, accent, maxW, onChange, onDelete }: NoteImageViewProps) {
  const startRef = useRef<{
    corner: Corner;
    x: number;
    y: number;
    w: number;
    h: number;
    aspect: number;
  } | null>(null);
  const [drafting, setDrafting] = useState<{ w: number; h: number } | null>(null);

  // Displayed size respects the parent's width cap; height scales with aspect
  // so a clamped-width image keeps proportions.
  const displayW = Math.min(image.w, maxW);
  const displayH = image.w > 0 ? image.h * (displayW / image.w) : image.h;

  const beginResize = (corner: Corner) => (evt: React.PointerEvent) => {
    evt.preventDefault();
    evt.stopPropagation();
    (evt.target as Element).setPointerCapture?.(evt.pointerId);
    startRef.current = {
      corner,
      x: evt.clientX,
      y: evt.clientY,
      w: displayW,
      h: displayH,
      aspect: displayW / Math.max(displayH, 1),
    };
    setDrafting({ w: displayW, h: displayH });
  };

  const onMove = (evt: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    let dx = evt.clientX - s.x;
    let dy = evt.clientY - s.y;
    // TL / BL move the left edge → invert dx for width math.
    if (s.corner === "tl" || s.corner === "bl") dx = -dx;
    // TL / TR move the top edge → invert dy for height math.
    if (s.corner === "tl" || s.corner === "tr") dy = -dy;
    let nw = clamp(s.w + dx, IMG_MIN, maxW);
    let nh = clamp(s.h + dy, IMG_MIN, IMG_MAX);
    if (evt.shiftKey) {
      // Lock to original aspect — pick the dominant axis (whichever moved more
      // in absolute pixels) and derive the other, re-clamping both bounds.
      if (Math.abs(dx) >= Math.abs(dy)) nh = clamp(nw / s.aspect, IMG_MIN, IMG_MAX);
      else nw = clamp(nh * s.aspect, IMG_MIN, maxW);
    }
    setDrafting({ w: Math.round(nw), h: Math.round(nh) });
  };

  const endResize = (evt: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    (evt.target as Element).releasePointerCapture?.(evt.pointerId);
    startRef.current = null;
    const final = drafting ?? { w: displayW, h: displayH };
    setDrafting(null);
    if (final.w !== image.w || final.h !== image.h) {
      onChange({ ...image, w: final.w, h: final.h });
    }
  };

  const w = drafting?.w ?? displayW;
  const h = drafting?.h ?? displayH;
  const handleSize = 10;
  const handleStyle = (corner: Corner): React.CSSProperties => {
    const cursor =
      corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize";
    const pos: React.CSSProperties = {};
    if (corner === "tl") {
      pos.left = -handleSize / 2;
      pos.top = -handleSize / 2;
    } else if (corner === "tr") {
      pos.right = -handleSize / 2;
      pos.top = -handleSize / 2;
    } else if (corner === "bl") {
      pos.left = -handleSize / 2;
      pos.bottom = -handleSize / 2;
    } else {
      pos.right = -handleSize / 2;
      pos.bottom = -handleSize / 2;
    }
    return {
      position: "absolute",
      width: handleSize,
      height: handleSize,
      background: "var(--paper)",
      border: `1.5px solid ${accent}`,
      borderRadius: 2,
      cursor,
      touchAction: "none",
      ...pos,
    };
  };

  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <img
        src={image.src}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: 4,
          display: "block",
          userSelect: "none",
          // Pointer events stay on the img element so ReactFlow's drag picks
          // up pointerdowns over the image area and treats them as a card
          // drag — the image is part of the card content, not a separate
          // interactive surface.
        }}
      />
      {showHandles && (
        <>
          {(["tl", "tr", "bl", "br"] as Corner[]).map((c) => (
            <div
              key={c}
              onPointerDown={beginResize(c)}
              onPointerMove={onMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              style={handleStyle(c)}
            />
          ))}
          <button
            type="button"
            aria-label="remove image"
            className="nodrag nopan"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 18,
              height: 18,
              borderRadius: 9,
              border: "none",
              background: "rgba(26,24,20,0.55)",
              color: "var(--paper)",
              fontSize: 12,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// When a note is marked done, swap the saturated accent for a muted gray so the
// card visibly recedes on the board (Apple Reminders / Things style). Hue is
// defined per palette in src/index.css.
const DONE_FRAME_COLOR = "var(--note-done)";
// "Working on" indicator color — defined per palette so it stays in step with
// the paper hue. Distinct from any user-pickable swatch in `NOTE_COLORS`.
const WORKING_COLOR = "var(--note-working)";

type Props = NodeProps & { data: NoteData };

function NoteCardImpl({ data, selected }: Props) {
  const [editing, setEditing] = useState<boolean>(Boolean(data.autoEdit));
  const [segments, setSegments] = useState<string[]>(() => deriveSegments(data));
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

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

  // Sync local segments from external data when not editing (e.g. after a
  // server-authoritative replace). During editing we hold the user's draft.
  useEffect(() => {
    if (!editing) setSegments(deriveSegments(data));
  }, [data.body, data.textSegments, data.images, editing]);

  // External edit command from CanvasBoard (driven by editingNoteId): Space
  // on a focused note sets autoEdit → enter edit; mind-map Esc clears it →
  // exit edit. Local dblclick edits flip `editing` without touching autoEdit,
  // so this effect only fires on true external transitions.
  useEffect(() => {
    setEditing(Boolean(data.autoEdit));
  }, [data.autoEdit]);

  // On entering edit: focus the last non-empty segment's textarea (or the
  // first one if everything is empty). Cursor lands at end so users can keep
  // typing where they left off.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      let idx = -1;
      for (let i = segments.length - 1; i >= 0; i--) {
        if ((segments[i] ?? "").length > 0) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = 0;
      const el = textareaRefs.current[idx];
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // Autogrow each segment textarea so long notes expand the card instead of
  // scrolling internally. Re-run whenever any segment text changes.
  useEffect(() => {
    if (!editing) return;
    for (const el of textareaRefs.current) {
      if (!el) continue;
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, segments]);

  const commit = () => {
    const prevSegments = deriveSegments(data);
    if (!segmentsEqual(segments, prevSegments)) {
      data.onCommit?.({ body: segments.join("\n"), textSegments: segments });
    }
    setEditing(false);
    data.onEditEnd?.();
  };
  // Commit on blur only when focus leaves *every* segment textarea (Tab
  // between segments shouldn't close the editor). Defer to next frame so the
  // new focus target is already set.
  const onFieldBlur = () => {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      for (const ref of textareaRefs.current) if (a === ref) return;
      commit();
    });
  };
  const cancel = () => {
    setSegments(deriveSegments(data));
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

  const images = data.images ?? [];
  const hasImages = images.length > 0;

  // Card is fixed-width with a single layout — regardless of whether the
  // note holds text, images, or both. Image display width is capped to the
  // inner content area so the card never grows past its frame.
  const CARD_W = 280;
  const cardWidth = CARD_W;
  const imageMaxW = CARD_W - 8 - 24;

  const updateImage = (idx: number, next: NoteImage) => {
    const nextImages = images.map((img, i) => (i === idx ? next : img));
    data.onCommit?.({ images: nextImages });
  };
  // Remove image at idx — merges the two surrounding text segments back into
  // one so the segments array stays length = images.length + 1.
  const removeImage = (idx: number) => {
    const nextImages = images.filter((_, i) => i !== idx);
    const before = segments[idx] ?? "";
    const after = segments[idx + 1] ?? "";
    const merged = before && after ? `${before}\n${after}` : before || after;
    const nextSegments = [
      ...segments.slice(0, idx),
      merged,
      ...segments.slice(idx + 2),
    ];
    setSegments(nextSegments);
    data.onCommit?.({
      images: nextImages,
      body: nextSegments.join("\n"),
      textSegments: nextSegments,
    });
  };

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
        width: cardWidth,
        // The outer block is the color "frame" itself; the inner paper card
        // sits inside with concentric corner radii so the left stripe + top /
        // right / bottom border curve smoothly into each other (Apple HIG —
        // nested rounded rects use concentric, not stacked, corners).
        background: color,
        padding: "2px 2px 2px 6px",
        borderRadius: 10,
        // Selected glow tints the card frame colour at ~28%. color-mix lets
        // the source colour be either a user-picked hex or a `var(--…)` ref
        // (DONE/WORKING) — hex+alpha concatenation can't handle the latter.
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
            // working = blue-outlined frame with a strong inward halo (the
            // empty box "glows" from inside — Things 3-adjacent affordance
            // for an in-progress task); done = filled with the frame color
            // and a bold tilted check.
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

      <div style={{ display: "flex", flexDirection: "column", gap: editing ? 4 : 0 }}>
        {segments.map((segText, i) => {
          const isFirstSegment = i === 0;
          // Render one segment (block) — textarea while editing, styled text
          // while viewing. Empty segments are skipped in view mode so they
          // don't introduce phantom whitespace between image and body.
          const segmentNode = editing ? (
            <textarea
              key={`seg-${i}`}
              ref={(el) => {
                textareaRefs.current[i] = el;
              }}
              value={segText}
              data-note-textarea={isFirstSegment ? data.id : undefined}
              rows={1}
              placeholder={isFirstSegment ? "first line is the title…" : "add text…"}
              className="nodrag nopan"
              onChange={(e) => {
                const next = segments.slice();
                next[i] = e.target.value;
                setSegments(next);
              }}
              onKeyDown={sharedKeys}
              onBlur={onFieldBlur}
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
          ) : (
            segText ? (
              <div key={`seg-${i}`}>
                {segText.split("\n").map((line, lineIdx) => {
                  const isTitleLine = isFirstSegment && lineIdx === 0;
                  const lineStyle: React.CSSProperties = isTitleLine
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
                  return (
                    <div key={lineIdx} style={lineStyle}>
                      {line
                        ? renderTokens(line, {
                            accent: color,
                            resolveCardLink: data.resolveCardLink,
                            onJumpToCardNode: data.onJumpToCardNode,
                          })
                        : " "}
                    </div>
                  );
                })}
              </div>
            ) : isFirstSegment && !hasImages ? (
              <div
                key={`seg-${i}`}
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
            ) : null
          );
          const img = images[i];
          const imageNode = img ? (
            <div key={`img-${img.id}`} style={{ marginTop: editing || segText ? 6 : 0 }}>
              <NoteImageView
                image={img}
                showHandles={Boolean(selected)}
                accent={color}
                maxW={imageMaxW}
                onChange={(next) => updateImage(i, next)}
                onDelete={() => removeImage(i)}
              />
            </div>
          ) : null;
          return (
            <Fragment key={`block-${i}`}>
              {segmentNode}
              {imageNode}
            </Fragment>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);
