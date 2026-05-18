// Agent management is disabled in the Tauri-only runtime — the Node `node-pty`
// implementation was the only thing that ever drove this hook, and that
// dependency is gone. UI surface is kept (the "agent" tab + per-issue badges)
// behind this no-op stub so a future Rust pty migration can swap the
// implementation back in without touching the consumer call sites.

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

export const AGENT_DISABLED_MSG =
  "Agent management disabled in Tauri build (pending native pty migration)";

interface UseAgentSessionsResult {
  sessions: AgentSession[];
  byIssueId: Map<string, AgentSession>;
  refresh: () => Promise<void>;
  startSession: (issueId: string) => Promise<AgentSession | null>;
  stopSession: (sessionId: string) => Promise<void>;
}

// Module-level singleton so identity is stable across renders — callers wire
// `refresh` / `startSession` / `stopSession` into `useEffect` / `useMemo` deps
// that would otherwise re-run forever.
const STUB: UseAgentSessionsResult = {
  sessions: [],
  byIssueId: new Map(),
  refresh: async () => {},
  startSession: async () => null,
  stopSession: async () => {},
};

export function useAgentSessions(): UseAgentSessionsResult {
  return STUB;
}
