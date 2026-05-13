import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolve(__dirname, "..", "..", "public", "data");

export interface BoardData {
  issueMembers: Record<string, { x: number; y: number }>;
  noteNodes: { id: string; body: string; x: number; y: number; color?: string }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }[];
}

const EMPTY: BoardData = { issueMembers: {}, noteNodes: [], edges: [] };

export const STORE_PATHS = {
  workingOn: resolve(DATA_DIR, "working_on.json"),
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

  return { issueMembers: members, noteNodes: notes, edges };
}
