import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Handle, NodeResizer, Position, useStore, type NodeProps } from "@xyflow/react";
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
  width?: number;
  height?: number;
  autoEdit?: boolean;
  resizeVisible?: boolean;
  /** This card's wiki-style id (`YYMMDDxx`); empty until migration runs. */
  cardId?: string;
  onCommit?: (patch: {
    body?: string;
    color?: string;
  }) => void;
  onResizeEnd?: (params: { x: number; y: number; width: number; height: number }) => void;
  onEditEnd?: () => void;
  /** Resolves a `[[cardId]]` reference to the corresponding xyflow node id on
   *  the active board, or null if no such card exists. */
  resolveCardLink?: (cardId: string) => string | null;
  /** Pan to the named node id while preserving the current zoom level. */
  onJumpToCardNode?: (nodeId: string) => void;
}

// Legacy notes size from content at this width until the user explicitly
// resizes them. Persisted dimensions then make the card fill its xyflow node.
const CARD_W = 280;

type Props = NodeProps & { data: NoteData };

function NoteCardImpl({ data, selected }: Props) {
  const [editing, setEditing] = useState<boolean>(Boolean(data.autoEdit));
  const [draftBody, setDraftBody] = useState<string>(data.body ?? "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const zoom = useStore((state) => state.transform[2]);

  const color = data.color ?? DEFAULT_NOTE_COLOR;
  const isSized = data.width !== undefined && data.height !== undefined;
  const imageMaxW = Math.max(80, (data.width ?? CARD_W) - 32);
  const inverseZoom = 1 / Math.max(0.2, zoom);

  // The overflow cue is based on the actual scroll container rather than a
  // text-length estimate. This keeps it correct for wrapping, images, fonts,
  // edits, and cards resized after they were created.
  const measureOverflow = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) {
      setShowOverflow(false);
      return;
    }
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    const remaining = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setShowOverflow(hasOverflow && remaining);
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let frame = 0;
    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        measureOverflow();
      });
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    const observed = [
      surface,
      ...Array.from(surface.querySelectorAll<HTMLElement>(".note-card__content, img, textarea")),
    ];
    observed.forEach((target) => resizeObserver?.observe(target));

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleMeasure)
        : null;
    mutationObserver?.observe(surface, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    const imageListeners: Array<{ image: HTMLImageElement; type: "load" | "error" }> = [];
    surface.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.addEventListener("load", scheduleMeasure);
      image.addEventListener("error", scheduleMeasure);
      imageListeners.push({ image, type: "load" }, { image, type: "error" });
    });
    surface.addEventListener("scroll", measureOverflow, { passive: true });
    document.fonts?.addEventListener("loadingdone", scheduleMeasure);
    scheduleMeasure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      surface.removeEventListener("scroll", measureOverflow);
      imageListeners.forEach(({ image, type }) => image.removeEventListener(type, scheduleMeasure));
      document.fonts?.removeEventListener("loadingdone", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [data.body, data.height, data.width, draftBody, editing, measureOverflow]);

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

  // Autogrow the textarea to its content. Unsized notes expand naturally;
  // explicitly resized notes keep their frame and scroll the surface instead.
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
  // Default styling treats the first real text line as a title. FigJam CSS
  // deliberately renders the title/body classes identically, without making
  // the React component aware of the active theme. Pure image refs do not count
  // as a title candidate.
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
  // Preserve outer blank lines in the stored/editable body while letting a
  // theme hide only their view-mode rows when centering visible content.
  const firstContentLineIdx = lines.findIndex((line) => line.trim().length > 0);
  const lastContentLineIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if ((lines[i] ?? "").trim().length > 0) return i;
    }
    return -1;
  })();
  const hasAnyContent = (data.body ?? "").trim().length > 0;

  return (
    <div
      className={`note-card${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}${isSized ? " is-sized" : ""}`}
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
      style={
        {
          "--note-color": color,
          "--note-handle-size": `${12 * inverseZoom}px`,
          "--note-handle-border": `${2 * inverseZoom}px`,
        } as React.CSSProperties
      }
    >
      <NodeResizer
        isVisible={Boolean(data.resizeVisible)}
        minWidth={120}
        minHeight={64}
        maxWidth={800}
        maxHeight={600}
        color="var(--accent)"
        lineClassName="note-resizer__line"
        handleClassName="note-resizer__handle"
        onResizeEnd={(_event, params) => data.onResizeEnd?.(params)}
      />
      <Handle id="t" type="source" position={Position.Top} className="note-card__handle" />
      <Handle id="r" type="source" position={Position.Right} className="note-card__handle" />
      <Handle id="b" type="source" position={Position.Bottom} className="note-card__handle" />
      <Handle id="l" type="source" position={Position.Left} className="note-card__handle" />

      <div ref={surfaceRef} className={`note-card__surface${isSized ? " nowheel" : ""}`}>
        <div className="note-card__meta">
          {/* Image-only notes (body has only `![](...)` tokens, no real text)
              skip the "Note" label so a paste-an-image card looks like a clean
              picture, not a NOTE-stamped placeholder. */}
          <span
            className="note-card__label"
            style={{ opacity: firstTextLineIdx >= 0 ? 1 : 0 }}
          >
            Note
          </span>
        </div>

        {editing ? (
          <textarea
            ref={textareaRef}
            value={draftBody}
            data-note-textarea={data.id}
            rows={1}
            placeholder="first line is the title…"
            className="note-card__content note-card__textarea nodrag nopan"
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={sharedKeys}
            onBlur={commit}
          />
        ) : !hasAnyContent ? (
          <div className="note-card__content note-card__placeholder">
            untitled (double-click to edit)
          </div>
        ) : (
          <div
            className={`note-card__content note-card__body${firstTextLineIdx < 0 ? " note-card__body--image-only" : ""}`}
          >
            {lines.map((line, idx) => {
              const isTitleLine = idx === firstTextLineIdx;
              // Treat a "pure image ref" line as a block element with no extra
              // wrapping text styles — the `<img>` from renderTokens carries
              // its own margin. Other lines get title / body typography.
              const isPureImageLine = /^!\[\]\([A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)\)$/.test(
                line.trim(),
              );
              const isOuterEmptyLine =
                !line.trim() && (idx < firstContentLineIdx || idx > lastContentLineIdx);
              if (isPureImageLine) {
                return (
                  <div key={idx} className="note-card__image-line">
                    {renderTokens(line, {
                      accent: "var(--accent)",
                      resolveCardLink: data.resolveCardLink,
                      onJumpToCardNode: data.onJumpToCardNode,
                      imageMaxW,
                    })}
                  </div>
                );
              }
              return (
                <div
                  key={idx}
                  className={`note-card__line note-card__line--${isTitleLine ? "title" : "body"}${isOuterEmptyLine ? " note-card__line--outer-empty" : ""}`}
                >
                  {line
                    ? renderTokens(line, {
                        accent: "var(--accent)",
                        resolveCardLink: data.resolveCardLink,
                        onJumpToCardNode: data.onJumpToCardNode,
                        imageMaxW,
                      })
                    : " "}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showOverflow && (
        <span className="note-card__overflow-indicator" aria-hidden="true">
          …
        </span>
      )}
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);
