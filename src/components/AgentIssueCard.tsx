import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { IssueRecord } from "../linear/types";
import { useAgentCardCtx } from "../lib/agentCardContext";
import { formatAgentTag, parseAgentTag, type AgentKind } from "../lib/agentProtocol";
import type { AgentSession, AgentSessionStatus } from "../lib/useAgentSessions";

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  background: "var(--canvas)",
  border: "1.5px solid var(--ink-soft)",
};

const STATUS_LABEL: Record<AgentSessionStatus, string> = {
  running: "● running",
  "waiting-input": "❓ awaiting reply",
  "waiting-merge": "⌛ waiting to merge",
  done: "✓ done",
  error: "⚠ error",
};

const STATUS_BG: Record<AgentSessionStatus, string> = {
  running: "#1f8a52",
  "waiting-input": "#c97a1f",
  "waiting-merge": "#7c4ec9",
  done: "#5a5a5a",
  error: "#b03030",
};

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

type Props = NodeProps & { data: IssueRecord };

function AgentIssueCardImpl({ data, selected }: Props) {
  const ctx = useAgentCardCtx();
  const session = ctx.sessionForIssue(data.id);

  return (
    <div
      style={{
        width: 340,
        background: "var(--card)",
        border: `2px solid ${session ? STATUS_BG[session.status] : "var(--ink-soft)"}`,
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: selected
          ? `0 0 0 3px color-mix(in srgb, var(--ink-soft) 28%, transparent), 0 4px 14px rgba(0,0,0,0.14)`
          : "0 1px 0 rgba(0,0,0,0.05)",
        color: "var(--ink)",
        cursor: "grab",
        fontFamily: "var(--sans)",
      }}
    >
      <Handle id="t" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="r" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="l" type="source" position={Position.Left} style={HANDLE_STYLE} />

      <Header issue={data} session={session ?? null} />
      <Title issue={data} />

      {!session || session.status === "done" || session.status === "error" ? (
        <LaunchRow issueId={data.id} />
      ) : (
        <ActiveBody issue={data} session={session} />
      )}
    </div>
  );
}

function Header({ issue, session }: { issue: IssueRecord; session: AgentSession | null }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 10,
        color: "var(--muted)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        marginBottom: 4,
      }}
    >
      <span style={{ fontWeight: 700 }}>{issue.identifier}</span>
      {session && (
        <span
          style={{
            color: "#fff",
            background: STATUS_BG[session.status],
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 10,
            letterSpacing: "0.06em",
          }}
        >
          {STATUS_LABEL[session.status]}
        </span>
      )}
    </div>
  );
}

function Title({ issue }: { issue: IssueRecord }) {
  return (
    <div
      style={{
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1.3,
        marginBottom: 10,
      }}
    >
      {issue.title}
    </div>
  );
}

function LaunchRow({ issueId }: { issueId: string }) {
  const ctx = useAgentCardCtx();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await ctx.start(issueId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        width: "100%",
        padding: "10px 14px",
        background: busy ? "var(--paper-soft)" : "var(--ink)",
        color: busy ? "var(--muted)" : "var(--paper)",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.04em",
        cursor: busy ? "wait" : "pointer",
      }}
    >
      {busy ? "starting…" : "▶  启动 agent"}
    </button>
  );
}

function ActiveBody({ issue, session }: { issue: IssueRecord; session: AgentSession }) {
  const ctx = useAgentCardCtx();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const agentComments: Comment[] = issue.comments.filter((c) => parseAgentTag(c.body) !== null);

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const isMerge = /\bmerge\b/i.test(trimmed);
    const kind: AgentKind = isMerge ? "merge" : "reply";
    const body = formatAgentTag("user", kind, trimmed);
    setSending(true);
    try {
      const ok = await ctx.postComment(issue.id, body);
      if (ok) {
        setDraft("");
        await ctx.refreshIssues();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <CommentThread comments={agentComments} />
      <div
        className="nodrag"
        style={{
          marginTop: 8,
          display: "flex",
          gap: 6,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="reply, queue, or 'merge'… (⌘↵ to send)"
          rows={2}
          style={{
            flex: 1,
            background: "var(--paper-soft)",
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: "6px 8px",
            fontFamily: "var(--sans)",
            fontSize: 12,
            color: "var(--ink)",
            resize: "vertical",
            outline: "none",
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={sending || draft.trim().length === 0}
          style={{
            padding: "0 10px",
            background: "var(--ink)",
            color: "var(--paper)",
            border: "none",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: sending || !draft.trim() ? "default" : "pointer",
            opacity: sending || !draft.trim() ? 0.5 : 1,
          }}
        >
          send
        </button>
      </div>
    </>
  );
}

function CommentThread({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) {
    return (
      <div
        style={{
          padding: "10px",
          fontSize: 11,
          color: "var(--muted)",
          textAlign: "center",
          background: "var(--paper-soft)",
          borderRadius: 4,
        }}
      >
        agent 还没说话…
      </div>
    );
  }
  return (
    <div
      className="nodrag"
      style={{
        maxHeight: 220,
        overflowY: "auto",
        background: "var(--paper-soft)",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} />
      ))}
    </div>
  );
}

function CommentRow({ comment }: { comment: Comment }) {
  const tag = parseAgentTag(comment.body);
  if (!tag) return null;
  const isAgent = tag.role === "agent";
  return (
    <div
      style={{
        padding: "4px 6px",
        background: isAgent ? "var(--card)" : "color-mix(in srgb, var(--prio-low) 12%, var(--paper-soft))",
        border: "1px solid var(--hairline)",
        borderRadius: 3,
        fontSize: 11,
        lineHeight: 1.35,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginBottom: 2,
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        <span style={{ fontWeight: 700, color: isAgent ? "var(--prio-high)" : "var(--prio-low)" }}>
          {tag.role}:{tag.kind}
        </span>
        <span style={{ opacity: 0.6 }}>{new Date(comment.createdAt).toLocaleTimeString()}</span>
      </div>
      <div style={{ color: "var(--ink)" }}>{tag.summary}</div>
      {tag.freeform && (
        <div style={{ marginTop: 4, color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>
          {tag.freeform}
        </div>
      )}
    </div>
  );
}

export const AgentIssueCard = memo(AgentIssueCardImpl);
