import { readFile, writeFile, mkdir, rename, stat, unlink, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolve(__dirname, "..", "..", "public", "data");
const WORKING_ON_DIR = resolve(DATA_DIR, "working_on");
const VIEWS_MANIFEST = resolve(WORKING_ON_DIR, "views.json");
const LEGACY_WORKING_ON = resolve(DATA_DIR, "working_on.json");

export interface BoardData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: { id: string; body: string; x: number; y: number; color?: string; working?: boolean; done?: boolean }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }[];
  groups: { id: string; memberIds: string[] }[];
}

const EMPTY: BoardData = { issueMembers: {}, noteNodes: [], edges: [], groups: [] };

export const STORE_PATHS = {
  workingOnDir: WORKING_ON_DIR,
  viewsManifest: VIEWS_MANIFEST,
  legacyWorkingOn: LEGACY_WORKING_ON,
  allIssuesBoard: resolve(DATA_DIR, "all_issues_board.json"),
} as const;

export async function readBoard(path: string): Promise<BoardData> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

export async function writeBoard(path: string, data: unknown): Promise<BoardData> {
  const clean = validate(data);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(clean, null, 2), "utf8");
  return clean;
}

function validate(raw: unknown): BoardData {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const obj = raw as Record<string, unknown>;

  const members: BoardData["issueMembers"] = {};
  if (obj.issueMembers && typeof obj.issueMembers === "object") {
    for (const [k, v] of Object.entries(obj.issueMembers as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        const xy = v as { x?: unknown; y?: unknown };
        if (typeof xy.x === "number" && typeof xy.y === "number") {
          members[k] = { x: xy.x, y: xy.y };
        }
      }
    }
  }

  const notes: BoardData["noteNodes"] = [];
  if (Array.isArray(obj.noteNodes)) {
    for (const n of obj.noteNodes) {
      if (!n || typeof n !== "object") continue;
      const r = n as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.x === "number" &&
        typeof r.y === "number"
      ) {
        const rawBody = typeof r.body === "string" ? r.body : "";
        const legacyTitle = typeof r.title === "string" ? r.title : "";
        const merged =
          legacyTitle && !rawBody
            ? legacyTitle
            : legacyTitle && rawBody && !rawBody.startsWith(legacyTitle)
              ? `${legacyTitle}\n${rawBody}`
              : rawBody;
        const note: BoardData["noteNodes"][number] = {
          id: r.id,
          body: merged,
          x: r.x,
          y: r.y,
        };
        if (typeof r.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color)) {
          note.color = r.color;
        }
        if (typeof r.working === "boolean") {
          note.working = r.working;
        }
        if (typeof r.done === "boolean") {
          note.done = r.done;
        }
        notes.push(note);
      }
    }
  }

  const edges: BoardData["edges"] = [];
  if (Array.isArray(obj.edges)) {
    for (const e of obj.edges) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.source === "string" &&
        typeof r.target === "string"
      ) {
        const out: BoardData["edges"][number] = { id: r.id, source: r.source, target: r.target };
        if (typeof r.sourceHandle === "string") out.sourceHandle = r.sourceHandle;
        if (typeof r.targetHandle === "string") out.targetHandle = r.targetHandle;
        if (typeof r.label === "string") out.label = r.label;
        edges.push(out);
      }
    }
  }

  const groups: BoardData["groups"] = [];
  if (Array.isArray(obj.groups)) {
    for (const g of obj.groups) {
      if (!g || typeof g !== "object") continue;
      const r = g as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      if (!Array.isArray(r.memberIds)) continue;
      const memberIds: string[] = [];
      for (const m of r.memberIds) if (typeof m === "string") memberIds.push(m);
      // Drop trivial groups: a single-member "group" has nothing to drag together.
      if (memberIds.length < 2) continue;
      groups.push({ id: r.id, memberIds });
    }
  }

  return { issueMembers: members, noteNodes: notes, edges, groups };
}

// --- Working On multi-view storage ---

export interface ViewMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface ViewsManifest {
  views: ViewMeta[];
  activeId: string;
}

const ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

/**
 * Reject anything that could traverse the filesystem. ViewIds come from the
 * client via URL path segments, so this guard is load-bearing.
 */
export function assertSafeViewId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`invalid viewId: ${JSON.stringify(id)}`);
}

export function viewBoardPath(id: string): string {
  assertSafeViewId(id);
  return join(WORKING_ON_DIR, `${id}.json`);
}

// Match the client's shortId("wov") shape but generated server-side for migration.
function newViewId(): string {
  const t = Date.now().toString(36).slice(-4);
  const r = Math.random().toString(36).slice(2, 8);
  return `wov_${t}${r}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-05-14 周四` — server-side mirror of the client formatter. */
function formatDefaultViewName(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${yyyy}-${mm}-${dd} ${weekdays[d.getDay()]}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

function validateManifest(raw: unknown): ViewsManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.views) || typeof obj.activeId !== "string") return null;
  const views: ViewMeta[] = [];
  for (const v of obj.views) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.createdAt !== "string") continue;
    if (!ID_RE.test(r.id)) continue;
    views.push({ id: r.id, name: r.name, createdAt: r.createdAt });
  }
  if (views.length === 0) return null;
  const activeId = views.some((v) => v.id === obj.activeId) ? obj.activeId : views[0]!.id;
  return { views, activeId };
}

/**
 * Read the manifest; on first run or missing manifest, run a one-shot migration:
 * - if the legacy `public/data/working_on.json` exists, adopt it as the first view
 *   (named by its mtime); on success, delete the legacy file.
 * - otherwise, create one empty view with today's default name.
 */
export async function readManifest(): Promise<ViewsManifest> {
  try {
    const raw = await readFile(VIEWS_MANIFEST, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const m = validateManifest(parsed);
    if (m) return m;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  // First run — migrate or initialize.
  await mkdir(WORKING_ON_DIR, { recursive: true });

  if (await fileExists(LEGACY_WORKING_ON)) {
    try {
      const raw = await readFile(LEGACY_WORKING_ON, "utf8");
      const legacyBoard = validate(JSON.parse(raw) as unknown);
      const st = await stat(LEGACY_WORKING_ON);
      const id = newViewId();
      const name = formatDefaultViewName(new Date(st.mtimeMs));
      const targetPath = viewBoardPath(id);
      // Write new view first; only delete the legacy file once the new write is durable.
      await atomicWriteJson(targetPath, legacyBoard);
      await atomicWriteJson(VIEWS_MANIFEST, {
        views: [{ id, name, createdAt: new Date(st.mtimeMs).toISOString() }],
        activeId: id,
      });
      // Validate roundtrip before deleting source.
      const roundtrip = await readFile(targetPath, "utf8");
      validate(JSON.parse(roundtrip) as unknown);
      await unlink(LEGACY_WORKING_ON);
      console.log(`[boardStore] migrated working_on.json → views/${id}.json (${name})`);
    } catch (err) {
      console.warn(`[boardStore] legacy migration failed; legacy file kept:`, err);
      // Fall through to fresh-init below.
    }
  }

  // Read back after potential migration, otherwise create empty.
  try {
    const raw = await readFile(VIEWS_MANIFEST, "utf8");
    const m = validateManifest(JSON.parse(raw) as unknown);
    if (m) return m;
  } catch {
    /* fall through */
  }

  const id = newViewId();
  const m: ViewsManifest = {
    views: [{ id, name: formatDefaultViewName(new Date()), createdAt: new Date().toISOString() }],
    activeId: id,
  };
  await atomicWriteJson(viewBoardPath(id), { ...EMPTY });
  await atomicWriteJson(VIEWS_MANIFEST, m);
  return m;
}

export async function writeManifest(raw: unknown): Promise<ViewsManifest> {
  const m = validateManifest(raw);
  if (!m) throw new Error("invalid manifest payload");
  if (m.views.length === 0) throw new Error("manifest must contain at least one view");
  await atomicWriteJson(VIEWS_MANIFEST, m);
  return m;
}

export async function readViewBoard(id: string): Promise<BoardData> {
  return readBoard(viewBoardPath(id));
}

export async function writeViewBoard(id: string, data: unknown): Promise<BoardData> {
  return writeBoard(viewBoardPath(id), data);
}

export async function deleteViewBoard(id: string): Promise<void> {
  const p = viewBoardPath(id);
  try {
    await unlink(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}
