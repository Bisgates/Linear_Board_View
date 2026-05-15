// Tag protocol for agent ↔ user messages stored as Linear comments.
// First line of a comment body: `[<role>:<kind>] <one-line summary>`
// Optional: blank line + freeform body.

export type AgentRole = "agent" | "user";
export type AgentKind =
  | "status"
  | "question"
  | "waiting-merge"
  | "done"
  | "reply"
  | "queue"
  | "merge";

const AGENT_KINDS: ReadonlySet<AgentKind> = new Set([
  "status",
  "question",
  "waiting-merge",
  "done",
]);
const USER_KINDS: ReadonlySet<AgentKind> = new Set(["reply", "queue", "merge"]);

export interface AgentTag {
  role: AgentRole;
  kind: AgentKind;
  summary: string;
  freeform: string | null;
}

export function formatAgentTag(
  role: AgentRole,
  kind: AgentKind,
  summary: string,
  freeform?: string | null,
): string {
  if (!isKindValidForRole(role, kind)) {
    throw new Error(`agentProtocol: kind "${kind}" is not valid for role "${role}"`);
  }
  if (summary.includes("\n")) {
    throw new Error("agentProtocol: summary must be a single line");
  }
  const head = `[${role}:${kind}] ${summary}`;
  if (freeform && freeform.length > 0) {
    return `${head}\n\n${freeform}`;
  }
  return head;
}

const TAG_LINE_RE = /^\[(agent|user):([a-z-]+)\]\s+(.*)$/;

export function parseAgentTag(body: string): AgentTag | null {
  const newlineIdx = body.indexOf("\n");
  const firstLine = newlineIdx === -1 ? body : body.slice(0, newlineIdx);
  const m = firstLine.match(TAG_LINE_RE);
  if (!m || !m[1] || !m[2] || m[3] === undefined) return null;
  const role = m[1] as AgentRole;
  const kind = m[2] as AgentKind;
  if (!isKindValidForRole(role, kind)) return null;
  const summary = m[3].trim();

  let freeform: string | null = null;
  if (newlineIdx !== -1) {
    const rest = body.slice(newlineIdx + 1);
    const trimmed = rest.replace(/^\n+/, "");
    if (trimmed.length > 0) freeform = trimmed;
  }

  return { role, kind, summary, freeform };
}

function isKindValidForRole(role: AgentRole, kind: AgentKind): boolean {
  if (role === "agent") return AGENT_KINDS.has(kind);
  if (role === "user") return USER_KINDS.has(kind);
  return false;
}
