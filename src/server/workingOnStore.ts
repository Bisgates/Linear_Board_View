import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORE_PATH = resolve(__dirname, "..", "..", "public", "data", "working_on.json");

export interface WorkingOnData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: { id: string; body: string; x: number; y: number; color?: string }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }[];
}

const EMPTY: WorkingOnData = { issueMembers: {}, noteNodes: [], edges: [] };

export async function readWorkingOn(): Promise<WorkingOnData> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

export async function writeWorkingOn(data: unknown): Promise<WorkingOnData> {
  const clean = validate(data);
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(clean, null, 2), "utf8");
  return clean;
}

function validate(raw: unknown): WorkingOnData {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const obj = raw as Record<string, unknown>;

  const members: WorkingOnData["issueMembers"] = {};
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

  const notes: WorkingOnData["noteNodes"] = [];
  if (Array.isArray(obj.noteNodes)) {
    for (const n of obj.noteNodes) {
      if (!n || typeof n !== "object") continue;
      const r = n as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.x === "number" &&
        typeof r.y === "number"
      ) {
        // Migrate legacy { title, body } into a single body string (title becomes first line).
        const rawBody = typeof r.body === "string" ? r.body : "";
        const legacyTitle = typeof r.title === "string" ? r.title : "";
        const merged =
          legacyTitle && !rawBody
            ? legacyTitle
            : legacyTitle && rawBody && !rawBody.startsWith(legacyTitle)
              ? `${legacyTitle}\n${rawBody}`
              : rawBody;
        const note: WorkingOnData["noteNodes"][number] = {
          id: r.id,
          body: merged,
          x: r.x,
          y: r.y,
        };
        if (typeof r.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color)) {
          note.color = r.color;
        }
        notes.push(note);
      }
    }
  }

  const edges: WorkingOnData["edges"] = [];
  if (Array.isArray(obj.edges)) {
    for (const e of obj.edges) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.source === "string" &&
        typeof r.target === "string"
      ) {
        const out: WorkingOnData["edges"][number] = { id: r.id, source: r.source, target: r.target };
        if (typeof r.sourceHandle === "string") out.sourceHandle = r.sourceHandle;
        if (typeof r.targetHandle === "string") out.targetHandle = r.targetHandle;
        if (typeof r.label === "string") out.label = r.label;
        edges.push(out);
      }
    }
  }

  return { issueMembers: members, noteNodes: notes, edges };
}
