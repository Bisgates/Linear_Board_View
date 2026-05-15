import { createContext, useContext } from "react";
import type { AgentSession } from "./useAgentSessions";

export interface AgentCardContextValue {
  sessionForIssue: (issueId: string) => AgentSession | undefined;
  start: (issueId: string) => Promise<AgentSession | null>;
  stop: (sessionId: string) => Promise<void>;
  postComment: (issueId: string, body: string) => Promise<boolean>;
  refreshIssues: () => Promise<void>;
}

const Ctx = createContext<AgentCardContextValue | null>(null);

export const AgentCardProvider = Ctx.Provider;

export function useAgentCardCtx(): AgentCardContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAgentCardCtx must be used inside <AgentCardProvider>");
  return v;
}
