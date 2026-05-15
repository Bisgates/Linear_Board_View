/**
 * Wiki-style bi-directional link IDs for notes.
 *
 * Format: `YYMMDDxx` — 6 digit local date + 2 random a–z letters.
 *   YY  = year mod 100
 *   MM  = month, 01–12
 *   DD  = day, 01–31
 *   xx  = two random lowercase ascii letters (676 / day, plenty for one user)
 *
 * Links inside note bodies are written as `[[260515cd]]` and rendered as
 * clickable cross-references. The wiki layer is independent from xyflow's
 * node id (which stays the volatile internal `n_xxxxx` short id).
 */

export const CARD_ID_RE = /^[0-9]{6}[a-z]{2}$/;

// Greedy capture used by note rendering: every `[[YYMMDDxx]]` occurrence with
// no leading / trailing whitespace inside the brackets, no other characters.
// The strict shape guards against false positives like `[[260515]]` or
// `[[ 260515cd ]]` which the user explicitly asked to skip.
export const CARD_LINK_RE = /\[\[([0-9]{6}[a-z]{2})\]\]/g;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format the date prefix `YYMMDD` from a local-time `Date`. Local timezone is
 * intentional — single-user app, the user thinks in their wall clock, not
 * UTC.
 */
export function formatDatePrefix(d: Date): string {
  const yy = pad2(d.getFullYear() % 100);
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yy}${mm}${dd}`;
}

function randomLetter(): string {
  // 26 lowercase letters; charCode 97–122.
  return String.fromCharCode(97 + Math.floor(Math.random() * 26));
}

/**
 * Mint a fresh card id for a note created on `createdAt`, avoiding any id
 * already present in `existingIds`. Tries random letter pairs up to
 * `maxAttempts` times before falling back to a deterministic sweep over the
 * full 26x26 suffix space (so we *cannot* return a collision while any slot
 * remains for that day).
 *
 * Returns `null` only if every 676 suffixes for the given day are occupied —
 * a fail-loud signal rather than silently picking a colliding id.
 */
export function generateCardId(
  createdAt: Date,
  existingIds: ReadonlySet<string>,
  maxAttempts = 32,
): string | null {
  const prefix = formatDatePrefix(createdAt);

  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = `${prefix}${randomLetter()}${randomLetter()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  // Exhaustive fallback — only matters when randomness keeps colliding on a
  // very saturated day. Walks aa, ab, ac, ..., zz in order.
  for (let i = 0; i < 26; i += 1) {
    for (let j = 0; j < 26; j += 1) {
      const candidate = `${prefix}${String.fromCharCode(97 + i)}${String.fromCharCode(97 + j)}`;
      if (!existingIds.has(candidate)) return candidate;
    }
  }
  return null;
}

export function isValidCardId(s: string): boolean {
  return CARD_ID_RE.test(s);
}

/**
 * Parse all `[[id]]` link occurrences out of `text`. Returned spans are
 * non-overlapping and ordered. Plain-text segments between matches are not
 * included — the caller is expected to interleave them by tracking
 * `lastIndex`.
 */
export interface CardLinkMatch {
  /** The card id captured between the brackets. */
  id: string;
  /** Index of the leading `[`. */
  start: number;
  /** Index just past the trailing `]` (exclusive). */
  end: number;
}

export function findCardLinks(text: string): CardLinkMatch[] {
  const out: CardLinkMatch[] = [];
  // Always start fresh — module-scope regex with global flag.
  CARD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CARD_LINK_RE.exec(text)) !== null) {
    out.push({ id: m[1]!, start: m.index, end: m.index + m[0].length });
  }
  return out;
}
