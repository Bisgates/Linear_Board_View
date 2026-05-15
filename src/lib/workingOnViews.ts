export interface ViewMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface ViewsManifest {
  views: ViewMeta[];
  activeId: string;
}

export interface ViewsClient {
  manifestEndpoint: string;
  boardEndpointFor: (id: string) => string;
  loadManifest: () => Promise<ViewsManifest>;
  saveManifest: (m: ViewsManifest) => Promise<ViewsManifest>;
  deleteViewBoard: (id: string) => Promise<void>;
}

export function createViewsClient(opts: {
  manifestEndpoint: string;
  boardEndpointFor: (id: string) => string;
}): ViewsClient {
  const { manifestEndpoint, boardEndpointFor } = opts;
  return {
    manifestEndpoint,
    boardEndpointFor,
    async loadManifest(): Promise<ViewsManifest> {
      const res = await fetch(manifestEndpoint, { cache: "no-cache" });
      if (!res.ok) throw new Error(`load manifest failed: ${res.status}`);
      return (await res.json()) as ViewsManifest;
    },
    async saveManifest(m: ViewsManifest): Promise<ViewsManifest> {
      const res = await fetch(manifestEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const text = await res.text();
          const parsed = JSON.parse(text) as { error?: unknown };
          detail = typeof parsed.error === "string" ? `: ${parsed.error}` : `: ${text}`;
        } catch {
          /* non-json body, ignore */
        }
        throw new Error(`save manifest failed: ${res.status}${detail}`);
      }
      const json = (await res.json()) as { ok: boolean; data?: ViewsManifest; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "save manifest: bad response");
      return json.data;
    },
    async deleteViewBoard(id: string): Promise<void> {
      const res = await fetch(boardEndpointFor(id), { method: "DELETE" });
      if (!res.ok) throw new Error(`delete view ${id} failed: ${res.status}`);
    },
  };
}

// --- Day (Working On) client — keeps the legacy module-level exports so
// existing callers stay untouched. ---

export const VIEWS_ENDPOINT = "/api/working-on/views";

export function viewBoardEndpoint(id: string): string {
  return `/api/working-on/views/${encodeURIComponent(id)}`;
}

export const dayViewsClient: ViewsClient = createViewsClient({
  manifestEndpoint: VIEWS_ENDPOINT,
  boardEndpointFor: viewBoardEndpoint,
});

export const loadManifest = () => dayViewsClient.loadManifest();
export const saveManifest = (m: ViewsManifest) => dayViewsClient.saveManifest(m);
export const deleteViewBoard = (id: string) => dayViewsClient.deleteViewBoard(id);

// --- Custom client ---

export const CUSTOM_VIEWS_ENDPOINT = "/api/custom/views";

export function customViewBoardEndpoint(id: string): string {
  return `/api/custom/views/${encodeURIComponent(id)}`;
}

export const customViewsClient: ViewsClient = createViewsClient({
  manifestEndpoint: CUSTOM_VIEWS_ENDPOINT,
  boardEndpointFor: customViewBoardEndpoint,
});

// --- Naming ---

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / 86400000;
  return Math.floor(diff) + 1;
}

/** Returns names like `2026-05-15 20.4` — date plus `<weekOfYear>.<weekday>`.
 *  Week boundary is Sunday (Sunday=0), week 1 always contains Jan 1. */
export function formatDefaultViewName(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const jan1Dow = new Date(d.getFullYear(), 0, 1).getDay();
  const w = Math.floor((dayOfYear(d) + jan1Dow - 1) / 7) + 1;
  return `${yyyy}-${mm}-${dd} ${w}.${d.getDay()}`;
}

/** Append `(2)`, `(3)`… until the name is not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${base} (${i})`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/**
 * Pick the smallest `Custom N` not already taken. Unlike `uniqueName`, this
 * returns `Custom 1` first, not `Custom (2)` — Custom views start their own
 * counter rather than disambiguating a shared base.
 */
export function nextCustomName(taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let i = 1; i < 999; i += 1) {
    const candidate = `Custom ${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `Custom ${Date.now()}`;
}
