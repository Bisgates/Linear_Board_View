export interface NoteNode {
  id: string;
  body: string;
  x: number;
  y: number;
  color?: string;
}

/**
 * Note color palette — 8 Morandi tones spaced across the hue wheel so adjacent
 * swatches are clearly distinguishable on warm-cream paper. First entry is the
 * default (matches the original amber accent).
 */
export const NOTE_COLORS = [
  "#7a8b66", // sage (default)
  "#a86810", // amber
  "#a76e6e", // rose
  "#6b85a3", // slate blue
  "#8e6b8e", // plum
  "#b07b50", // terracotta
  "#6c7a7a", // teal-gray
  "#8b8170", // muted
] as const;

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0];

export interface WorkingOnEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface WorkingOnData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: NoteNode[];
  edges: WorkingOnEdge[];
}

export const EMPTY_WORKING_ON: WorkingOnData = {
  issueMembers: {},
  noteNodes: [],
  edges: [],
};

export async function loadWorkingOn(): Promise<WorkingOnData> {
  const res = await fetch("/api/working-on", { cache: "no-cache" });
  if (!res.ok) throw new Error(`load working-on failed: ${res.status}`);
  return (await res.json()) as WorkingOnData;
}

export async function saveWorkingOn(data: WorkingOnData): Promise<WorkingOnData> {
  const res = await fetch("/api/working-on", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`save working-on failed: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data?: WorkingOnData; error?: string };
  if (!json.ok || !json.data) throw new Error(json.error ?? "save working-on: bad response");
  return json.data;
}

// Tiny random id; not crypto, just unique enough within one user's session.
export function shortId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

/** Open a local file path or URL via the dev server's POST /api/open. */
export async function openLocalPath(p: string): Promise<void> {
  try {
    await fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }),
    });
  } catch (err) {
    console.error("[open] failed", err);
  }
}

/**
 * Find next empty grid slot for placing a freshly added node, scanning
 * row-by-row across 6 columns. Returns the first slot whose center is
 * outside MIN_DIST of every existing node center.
 */
const GRID_COLS = 6;
const GRID_DX = 320;
const GRID_DY = 180;
const MIN_DIST = 200;

export function findNextSlot(taken: { x: number; y: number }[]): { x: number; y: number } {
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const c = { x: col * GRID_DX, y: row * GRID_DY };
      let ok = true;
      for (const t of taken) {
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) {
          ok = false;
          break;
        }
      }
      if (ok) return c;
    }
  }
  return { x: 0, y: 0 };
}
