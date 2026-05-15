/**
 * Project → stable color.
 *
 * The actual hex values live in `src/index.css` as `--proj-1` … `--proj-12`
 * (+ `--proj-none`) — a hand-curated 12-stop deep-Morandi palette tuned to
 * read at a glance on the warm paper background without screaming. We hash
 * the project name onto a slot 1..12 and return a CSS `var(--proj-N)` ref.
 * Same name always lands on the same slot.
 *
 * Slots are hand-picked rather than interpolated so adjacent projects stay
 * visibly different in hue, avoiding the "they all look brownish" failure
 * mode of continuous HSL hashing at low saturation.
 */

const SLOT_COUNT = 12;
const NO_PROJECT_VAR = "var(--proj-none)";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function projectColor(name: string | undefined | null): string {
  if (!name) return NO_PROJECT_VAR;
  const slot = (hash(name) % SLOT_COUNT) + 1;
  return `var(--proj-${slot})`;
}

/** Subtle fill — uses CSS color-mix so it stays in step with the live palette. */
export function projectColorMuted(name: string | undefined | null): string {
  const base = projectColor(name);
  return `color-mix(in srgb, ${base} 20%, transparent)`;
}
