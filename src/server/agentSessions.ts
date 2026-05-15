// Persistent state for in-flight agent sessions.
// Written by the dev plugin; read by the client over GET /api/agent/sessions.
// File path is intentionally under public/data/ so the snapshot fetcher and the
// client can share the same data directory; only the dev plugin writes here.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export type AgentSessionStatus =
  | "running"
  | "waiting-input"
  | "waiting-merge"
  | "done"
  | "error";

export interface AgentSession {
  id: string;
  issueId: string;
  status: AgentSessionStatus;
  claudeConvId: string | null;
  worktreePath: string | null;
  lastCommentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentSessionsFile {
  sessions: Record<string, AgentSession>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSIONS_PATH = resolve(__dirname, "..", "..", "public", "data", "agent_sessions.json");

async function readSessionsFile(): Promise<AgentSessionsFile> {
  try {
    const raw = await readFile(SESSIONS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentSessionsFile>;
    return { sessions: parsed.sessions ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { sessions: {} };
    }
    throw err;
  }
}

async function writeSessionsFile(file: AgentSessionsFile): Promise<void> {
  await mkdir(dirname(SESSIONS_PATH), { recursive: true });
  await writeFile(SESSIONS_PATH, JSON.stringify(file, null, 2), "utf8");
}

export async function listSessions(): Promise<AgentSession[]> {
  const file = await readSessionsFile();
  return Object.values(file.sessions).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSession(id: string): Promise<AgentSession | null> {
  const file = await readSessionsFile();
  return file.sessions[id] ?? null;
}

export async function findActiveSessionByIssueId(issueId: string): Promise<AgentSession | null> {
  const file = await readSessionsFile();
  for (const s of Object.values(file.sessions)) {
    if (s.issueId === issueId && s.status !== "done" && s.status !== "error") return s;
  }
  return null;
}

export async function createSession(issueId: string): Promise<AgentSession> {
  const existing = await findActiveSessionByIssueId(issueId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const session: AgentSession = {
    id: randomUUID(),
    issueId,
    status: "running",
    claudeConvId: null,
    worktreePath: null,
    lastCommentId: null,
    createdAt: now,
    updatedAt: now,
  };
  const file = await readSessionsFile();
  file.sessions[session.id] = session;
  await writeSessionsFile(file);
  return session;
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<AgentSession, "id" | "issueId" | "createdAt">>,
): Promise<AgentSession> {
  const file = await readSessionsFile();
  const prev = file.sessions[id];
  if (!prev) throw new Error(`session ${id} not found`);
  const next: AgentSession = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  file.sessions[id] = next;
  await writeSessionsFile(file);
  return next;
}

export async function stopSession(id: string, status: AgentSessionStatus = "done"): Promise<AgentSession> {
  return updateSession(id, { status });
}
