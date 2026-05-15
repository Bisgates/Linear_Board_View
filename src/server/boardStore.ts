import { readFile, writeFile, mkdir, rename, stat, unlink, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolve(__dirname, "..", "..", "public", "data");
const WORKING_ON_DIR = resolve(DATA_DIR, "working_on");
const VIEWS_MANIFEST = resolve(WORKING_ON_DIR, "views.json");
const LEGACY_WORKING_ON = resolve(DATA_DIR, "working_on.json");
const CUSTOM_DIR = resolve(DATA_DIR, "custom");
const CUSTOM_VIEWS_MANIFEST = resolve(CUSTOM_DIR, "views.json");

export interface NoteImage {
  id: string;
  src: string;
  w: number;
  h: number;
}

export interface BoardData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: {
    id: string;
    body: string;
    x: number;
    y: number;
    color?: string;
    working?: boolean;
    done?: boolean;
    images?: NoteImage[];
    textSegments?: string[];
    // Wiki-style cross-reference id, format `YYMMDDxx`. See `lib/cardId.ts`.
    cardId?: string;
  }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }[];
  groups: { id: string; memberIds: string[] }[];
}

const EMPTY: BoardData = { issueMembers: {}, noteNodes: [], edges: [], groups: [] };

export const STORE_PATHS = {
  workingOnDir: WORKING_ON_DIR,
  viewsManifest: VIEWS_MANIFEST,
  legacyWorkingOn: LEGACY_WORKING_ON,
  customDir: CUSTOM_DIR,
  customViewsManifest: CUSTOM_VIEWS_MANIFEST,
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
        if (Array.isArray(r.images)) {
          const imgs: NoteImage[] = [];
          for (const img of r.images) {
            if (!img || typeof img !== "object") continue;
            const ir = img as Record<string, unknown>;
            if (
              typeof ir.id === "string" &&
              typeof ir.src === "string" &&
              ir.src.startsWith("data:image/") &&
              typeof ir.w === "number" &&
              typeof ir.h === "number" &&
              ir.w > 0 &&
              ir.h > 0
            ) {
              imgs.push({ id: ir.id, src: ir.src, w: ir.w, h: ir.h });
            }
          }
          if (imgs.length > 0) note.images = imgs;
        }
        // textSegments — accept only when shape matches `images.length + 1`.
        // Older notes without this field will be migrated on the client by
        // splitting `body` into segment 0 with trailing empty segments.
        const imgCount = note.images ? note.images.length : 0;
        if (Array.isArray(r.textSegments) && r.textSegments.length === imgCount + 1) {
          const segs: string[] = [];
          let allStrings = true;
          for (const s of r.textSegments) {
            if (typeof s !== "string") {
              allStrings = false;
              break;
            }
            segs.push(s);
          }
          if (allStrings) note.textSegments = segs;
        }
        // cardId — wiki-style cross-reference id (`YYMMDDxx`). The strict
        // shape mirrors `lib/cardId.ts` so a malformed value can't sneak in
        // through the persistence layer; missing values get filled by the
        // client-side migration on first load.
        if (typeof r.cardId === "string" && /^[0-9]{6}[a-z]{2}$/.test(r.cardId)) {
          note.cardId = r.cardId;
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

export function viewBoardPathAt(dir: string, id: string): string {
  assertSafeViewId(id);
  return join(dir, `${id}.json`);
}

export function viewBoardPath(id: string): string {
  return viewBoardPathAt(WORKING_ON_DIR, id);
}

export function customViewBoardPath(id: string): string {
  return viewBoardPathAt(CUSTOM_DIR, id);
}

// Match the client's shortId shape but generated server-side for migration.
function newViewId(prefix = "wov"): string {
  const t = Date.now().toString(36).slice(-4);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / 86400000;
  return Math.floor(diff) + 1;
}

/** `2026-05-15 20.4` — server-side mirror of the client formatter. */
function formatDefaultViewName(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const w = Math.floor((dayOfYear(d) - 1) / 7) + 1;
  return `${yyyy}-${mm}-${dd} ${w}.${d.getDay()}`;
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

interface ManifestSlot {
  dir: string;
  manifestPath: string;
  idPrefix: string;
  defaultName: (existing: string[]) => string;
}

/**
 * Generic read/init for a manifest slot. `legacyMigrate` runs once on the
 * first call when the manifest is missing — pass `null` for kinds (like
 * Custom) that have no legacy file to absorb.
 */
async function readManifestAt(
  slot: ManifestSlot,
  legacyMigrate: (() => Promise<ViewsManifest | null>) | null,
): Promise<ViewsManifest> {
  try {
    const raw = await readFile(slot.manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const m = validateManifest(parsed);
    if (m) return m;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  await mkdir(slot.dir, { recursive: true });

  if (legacyMigrate) {
    const migrated = await legacyMigrate();
    if (migrated) return migrated;
  }

  // Fresh init.
  const id = newViewId(slot.idPrefix);
  const m: ViewsManifest = {
    views: [{ id, name: slot.defaultName([]), createdAt: new Date().toISOString() }],
    activeId: id,
  };
  await atomicWriteJson(viewBoardPathAt(slot.dir, id), { ...EMPTY });
  await atomicWriteJson(slot.manifestPath, m);
  return m;
}

async function writeManifestAt(slot: ManifestSlot, raw: unknown): Promise<ViewsManifest> {
  const m = validateManifest(raw);
  if (!m) throw new Error("invalid manifest payload");
  if (m.views.length === 0) throw new Error("manifest must contain at least one view");
  await mkdir(slot.dir, { recursive: true });
  await atomicWriteJson(slot.manifestPath, m);
  return m;
}

async function readViewBoardAt(dir: string, id: string): Promise<BoardData> {
  return readBoard(viewBoardPathAt(dir, id));
}

async function writeViewBoardAt(dir: string, id: string, data: unknown): Promise<BoardData> {
  return writeBoard(viewBoardPathAt(dir, id), data);
}

async function deleteViewBoardAt(dir: string, id: string): Promise<void> {
  const p = viewBoardPathAt(dir, id);
  try {
    await unlink(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

const DAY_SLOT: ManifestSlot = {
  dir: WORKING_ON_DIR,
  manifestPath: VIEWS_MANIFEST,
  idPrefix: "wov",
  defaultName: () => formatDefaultViewName(new Date()),
};

const CUSTOM_SLOT: ManifestSlot = {
  dir: CUSTOM_DIR,
  manifestPath: CUSTOM_VIEWS_MANIFEST,
  idPrefix: "cv",
  defaultName: (existing) => nextCustomName(existing),
};

function nextCustomName(existing: string[]): string {
  const set = new Set(existing);
  for (let i = 1; i < 999; i += 1) {
    const candidate = `Custom ${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `Custom ${Date.now()}`;
}

async function dayLegacyMigrate(): Promise<ViewsManifest | null> {
  if (!(await fileExists(LEGACY_WORKING_ON))) return null;
  try {
    const raw = await readFile(LEGACY_WORKING_ON, "utf8");
    const legacyBoard = validate(JSON.parse(raw) as unknown);
    const st = await stat(LEGACY_WORKING_ON);
    const id = newViewId("wov");
    const name = formatDefaultViewName(new Date(st.mtimeMs));
    const targetPath = viewBoardPath(id);
    await atomicWriteJson(targetPath, legacyBoard);
    const m: ViewsManifest = {
      views: [{ id, name, createdAt: new Date(st.mtimeMs).toISOString() }],
      activeId: id,
    };
    await atomicWriteJson(VIEWS_MANIFEST, m);
    const roundtrip = await readFile(targetPath, "utf8");
    validate(JSON.parse(roundtrip) as unknown);
    await unlink(LEGACY_WORKING_ON);
    console.log(`[boardStore] migrated working_on.json → views/${id}.json (${name})`);
    return m;
  } catch (err) {
    console.warn(`[boardStore] legacy migration failed; legacy file kept:`, err);
    return null;
  }
}

/**
 * Old day view name shape: `YYYY-MM-DD 周X` with optional `(N)` collision tail.
 * Capture group 4 keeps any trailing suffix (e.g. " (2)") so we can preserve it.
 */
const LEGACY_DAY_NAME_RE = /^(\d{4})-(\d{2})-(\d{2}) 周[日一二三四五六](.*)$/;

/**
 * One-shot rewrite of stored day view names from `YYYY-MM-DD 周X` to the new
 * `YYYY-MM-DD WW.D` shape. Returns the migrated manifest plus a `changed` flag
 * so the caller can skip disk writes when nothing moved (preserves mtime,
 * idempotent on re-read).
 */
function migrateDayManifestNames(m: ViewsManifest): { manifest: ViewsManifest; changed: boolean } {
  let changed = false;
  const views = m.views.map((v) => {
    const match = LEGACY_DAY_NAME_RE.exec(v.name);
    if (!match) return v;
    const [, yyyy, mm, dd, tail] = match;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    const next = `${formatDefaultViewName(d)}${tail}`;
    if (next === v.name) return v;
    changed = true;
    return { ...v, name: next };
  });
  return { manifest: changed ? { views, activeId: m.activeId } : m, changed };
}

/**
 * Read the day (Working On) manifest; on first run, migrate
 * `public/data/working_on.json` if it exists, otherwise create one empty view
 * named with today's default. Also rewrites any lingering `周X`-format view
 * names from before v0.21.0 in place.
 */
export async function readManifest(): Promise<ViewsManifest> {
  const raw = await readManifestAt(DAY_SLOT, dayLegacyMigrate);
  const { manifest, changed } = migrateDayManifestNames(raw);
  if (changed) {
    await atomicWriteJson(VIEWS_MANIFEST, manifest);
    console.log(`[boardStore] migrated day view names to WW.D format`);
  }
  return manifest;
}

export async function writeManifest(raw: unknown): Promise<ViewsManifest> {
  return writeManifestAt(DAY_SLOT, raw);
}

export async function readViewBoard(id: string): Promise<BoardData> {
  return readViewBoardAt(WORKING_ON_DIR, id);
}

export async function writeViewBoard(id: string, data: unknown): Promise<BoardData> {
  return writeViewBoardAt(WORKING_ON_DIR, id, data);
}

export async function deleteViewBoard(id: string): Promise<void> {
  return deleteViewBoardAt(WORKING_ON_DIR, id);
}

// --- Custom views (no legacy migration) ---

export async function readCustomManifest(): Promise<ViewsManifest> {
  return readManifestAt(CUSTOM_SLOT, null);
}

export async function writeCustomManifest(raw: unknown): Promise<ViewsManifest> {
  return writeManifestAt(CUSTOM_SLOT, raw);
}

export async function readCustomViewBoard(id: string): Promise<BoardData> {
  return readViewBoardAt(CUSTOM_DIR, id);
}

export async function writeCustomViewBoard(id: string, data: unknown): Promise<BoardData> {
  return writeViewBoardAt(CUSTOM_DIR, id, data);
}

export async function deleteCustomViewBoard(id: string): Promise<void> {
  return deleteViewBoardAt(CUSTOM_DIR, id);
}
