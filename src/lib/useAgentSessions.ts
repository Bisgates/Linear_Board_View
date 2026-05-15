import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const POLL_MS = 3000;

interface UseAgentSessionsResult {
  sessions: AgentSession[];
  byIssueId: Map<string, AgentSession>;
  refresh: () => Promise<void>;
  startSession: (issueId: string) => Promise<AgentSession | null>;
  stopSession: (sessionId: string) => Promise<void>;
}

export function useAgentSessions(): UseAgentSessionsResult {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/sessions");
      const json = (await res.json()) as { ok: boolean; sessions?: AgentSession[] };
      if (json.ok && json.sessions) setSessions(json.sessions);
    } catch (err) {
      console.error("[useAgentSessions] refresh failed", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = window.setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [refresh]);

  const startSession = useCallback(async (issueId: string): Promise<AgentSession | null> => {
    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId }),
      });
      const json = (await res.json()) as { ok: boolean; session?: AgentSession; error?: string };
      if (!json.ok || !json.session) throw new Error(json.error ?? "start failed");
      await refresh();
      return json.session;
    } catch (err) {
      console.error("[useAgentSessions] start failed", err);
      return null;
    }
  }, [refresh]);

  const stopSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      await fetch(`/api/agent/${sessionId}/stop`, { method: "POST" });
      await refresh();
    } catch (err) {
      console.error("[useAgentSessions] stop failed", err);
    }
  }, [refresh]);

  const byIssueId = useMemo(() => {
    const m = new Map<string, AgentSession>();
    for (const s of sessions) {
      const cur = m.get(s.issueId);
      if (!cur || cur.updatedAt < s.updatedAt) m.set(s.issueId, s);
    }
    return m;
  }, [sessions]);

  return { sessions, byIssueId, refresh, startSession, stopSession };
}
