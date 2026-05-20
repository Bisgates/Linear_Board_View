/**
 * One-shot migration from the legacy `images[] + textSegments[]` shape to the
 * markdown-with-`![](hash.ext)` shape. Runs on every board load — idempotent,
 * because notes without legacy fields short-circuit at the call site.
 *
 * For each legacy image we:
 *   1. Decode its `data:image/...;base64,...` source URL into raw bytes.
 *   2. Call `saveImageBytes` (Rust side, sha256-content-addressed) to write
 *      the file under `<data>/images/` and get back the on-disk filename.
 *   3. Splice `![](<filename>)` into the body in the slot it used to occupy
 *      relative to `textSegments`.
 *
 * After migration the note's stored shape is just `{ id, body, x, y, ... }` —
 * `images` and `textSegments` are gone entirely.
 */

import { saveImageBytes } from "./tauriInvoke";
import type { NoteNode } from "./workingOn";

interface LegacyNoteImage {
  id: string;
  src: string; // `data:image/jpeg;base64,...` or similar
  w: number;
  h: number;
}

interface MaybeLegacyNote extends NoteNode {
  images?: LegacyNoteImage[];
  textSegments?: string[];
}

function decodeDataUrl(src: string): Uint8Array | null {
  // Accept any image/* data URL; everything is re-saved on disk so the original
  // mime only matters for our `![](.../<ext>)` choice below.
  const commaIdx = src.indexOf(",");
  if (commaIdx < 0) return null;
  const header = src.slice(0, commaIdx);
  if (!header.startsWith("data:image/")) return null;
  if (!header.includes(";base64")) return null;
  const b64 = src.slice(commaIdx + 1);
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hasLegacyShape(note: MaybeLegacyNote): boolean {
  return (
    (Array.isArray(note.images) && note.images.length > 0) ||
    (Array.isArray(note.textSegments) && note.textSegments.length > 1)
  );
}

/**
 * Returns `{ next, migrated }`. `migrated` counts notes whose shape changed
 * (i.e. had at least one legacy image successfully written to disk and
 * replaced with a markdown ref). Notes without legacy fields are returned
 * unchanged. Notes whose images all failed to decode get their stale fields
 * stripped anyway so the migration becomes idempotent on the next boot.
 */
export async function migrateImageNotes(
  notes: ReadonlyArray<NoteNode>,
): Promise<{ next: NoteNode[]; migrated: number }> {
  let migrated = 0;
  const next: NoteNode[] = [];
  for (const raw of notes) {
    const note = raw as MaybeLegacyNote;
    if (!hasLegacyShape(note)) {
      next.push(raw);
      continue;
    }
    const images = note.images ?? [];
    const segments = Array.isArray(note.textSegments)
      ? note.textSegments
      : null;
    // Build the new body by interleaving segments and image refs in the same
    // order the legacy renderer used. If segments is missing/malformed, fall
    // back to body + all images appended.
    const parts: string[] = [];
    if (segments && segments.length === images.length + 1) {
      for (let i = 0; i < images.length; i++) {
        const seg = segments[i] ?? "";
        if (seg) parts.push(seg);
        const img = images[i];
        if (!img) continue;
        const bytes = decodeDataUrl(img.src);
        if (bytes) {
          const filename = await saveImageBytes(bytes);
          parts.push(`![](${filename})`);
        }
      }
      const tail = segments[images.length] ?? "";
      if (tail) parts.push(tail);
    } else {
      if (note.body) parts.push(note.body);
      for (const img of images) {
        const bytes = decodeDataUrl(img.src);
        if (bytes) {
          const filename = await saveImageBytes(bytes);
          parts.push(`![](${filename})`);
        }
      }
    }
    const body = parts.join("\n\n");
    // Strip legacy fields by reconstructing the canonical shape (don't just
    // spread — that would carry `images` / `textSegments` along, defeating
    // idempotency).
    const cleaned: NoteNode = {
      id: note.id,
      body,
      x: note.x,
      y: note.y,
    };
    if (note.color !== undefined) cleaned.color = note.color;
    if (note.working !== undefined) cleaned.working = note.working;
    if (note.done !== undefined) cleaned.done = note.done;
    if (note.cardId !== undefined) cleaned.cardId = note.cardId;
    next.push(cleaned);
    migrated += 1;
  }
  return { next, migrated };
}

/** Cheap synchronous check used by App.tsx to short-circuit the effect. */
export function noteNeedsImageMigration(note: NoteNode): boolean {
  return hasLegacyShape(note as MaybeLegacyNote);
}
