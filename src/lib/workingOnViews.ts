export interface ViewMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface ViewsManifest {
  views: ViewMeta[];
  activeId: string;
}

export const VIEWS_ENDPOINT = "/api/working-on/views";

export function viewBoardEndpoint(id: string): string {
  return `/api/working-on/views/${encodeURIComponent(id)}`;
}

export async function loadManifest(): Promise<ViewsManifest> {
  const res = await fetch(VIEWS_ENDPOINT, { cache: "no-cache" });
  if (!res.ok) throw new Error(`load manifest failed: ${res.status}`);
  return (await res.json()) as ViewsManifest;
}

export async function saveManifest(m: ViewsManifest): Promise<ViewsManifest> {
  const res = await fetch(VIEWS_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(m),
  });
  if (!res.ok) throw new Error(`save manifest failed: ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data?: ViewsManifest; error?: string };
  if (!json.ok || !json.data) throw new Error(json.error ?? "save manifest: bad response");
  return json.data;
}

export async function deleteViewBoard(id: string): Promise<void> {
  const res = await fetch(viewBoardEndpoint(id), { method: "DELETE" });
  if (!res.ok) throw new Error(`delete view ${id} failed: ${res.status}`);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Returns names like `2026-05-14 周四`. */
export function formatDefaultViewName(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd} ${WEEKDAYS[d.getDay()]}`;
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
