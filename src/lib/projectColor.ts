/**
 * Project → stable color. Uses a curated 12-stop deep-Morandi palette
 * (low saturation, mid-low lightness — distinct enough to read at a
 * glance on warm-cream paper, but not screaming). Hash project name to
 * pick a stop; same name always lands on the same color.
 *
 * Palette is hand-picked, not interpolated: ensures each adjacent project
 * has visibly different hue, avoiding the "they all look brownish" failure
 * mode of continuous HSL hashing at low saturation.
 */

const PALETTE = [
  "#7b3f44", // burgundy
  "#9a5e3f", // rust
  "#8a6f33", // mustard
  "#5e6f38", // moss
  "#386f4c", // forest
  "#3a6868", // dusty teal
  "#3e5f78", // slate blue
  "#4a4c7a", // indigo
  "#6a3f6e", // plum
  "#82385c", // wine
  "#5f4a3a", // cocoa
  "#3f4a5a", // graphite blue
];

const NO_PROJECT = "#8b8170"; // warm muted (matches --muted)

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function projectColor(name: string | undefined | null): string {
  if (!name) return NO_PROJECT;
  return PALETTE[hash(name) % PALETTE.length]!;
}

export function projectColorMuted(name: string | undefined | null): string {
  if (!name) return "rgba(139,129,112,0.35)";
  const base = projectColor(name);
  return `${base}33`; // ~20% alpha for subtle fills
}
