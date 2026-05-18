// v2 — long-lived interactive `claude` (no -p) per session, driven via PTY.
//
// Why PTY: `claude` without -p only enters TUI/interactive mode when stdout is a
// real TTY. Plain spawn() with stdio:"pipe" makes claude fall back to print
// mode (= -p semantics). node-pty gives us a pseudo-TTY so we drive the real
// interactive TUI programmatically.
//
// Why long-lived: each interactive process holds the full conversation in
// memory and benefits from prompt caching. Per-turn `-p` invocations would
// burn through Max session quota; one process per session counts as one
// session for the entire lifetime.
//
// Flow per session:
//   1. spawnAgent(): node-pty.spawn("claude", ...), 2s delay then write
//      INITIAL_PROMPT (bracketed paste so multi-line submits as one message).
//   2. Agent talks back via curl POST to /api/issue/:id/comment.
//   3. Poller tick: for each live session, fetch new [user:*] Linear comments
//      since lastCommentId, write them into PTY stdin (bracketed paste + Enter).
//   4. Detect [agent:done] → write "/exit\r" → kill after grace.
//
// Recovery: live PTY handles are in-memory only. On dev server restart we mark
// any orphaned running/waiting-* sessions as error.

import { LinearClient } from "@linear/sdk";
import * as nodePty from "node-pty";
import type { IPty } from "node-pty";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import {
  listSessions,
  updateSession,
  getSession,
  type AgentSession,
} from "./agentSessions.js";
import { parseAgentTag } from "../lib/agentProtocol.js";

const POLL_INTERVAL_MS = 5_000;
const POST_SPAWN_DELAY_MS = 2_500;
const EXIT_GRACE_MS = 3_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const WORKTREES_DIR = resolve(PROJECT_ROOT, "worktrees");

interface LiveAgent {
  sessionId: string;
  pty: IPty;
  logPath: string;
  exiting: boolean;
}

const live = new Map<string, LiveAgent>();
let timer: NodeJS.Timeout | null = null;
let bootstrapped = false;

// `claude` lives in ~/.local/bin on this user's machine, but `npm run dev`
// inherits a minimal PATH that may miss it. Resolve once via the user's login
// shell, fall back to common locations, fail loudly if nothing works.
let claudePath: string | null = null;
function resolveClaudePath(): string {
  if (claudePath) return claudePath;
  try {
    const out = execSync(`zsh -lc 'command -v claude'`, { encoding: "utf8" }).trim();
    if (out && existsSync(out)) {
      claudePath = out;
      return out;
    }
  } catch {
    // fall through to fallbacks
  }
  const candidates = [
    `${process.env.HOME ?? ""}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      claudePath = p;
      return p;
    }
  }
  throw new Error("Could not locate the `claude` binary on PATH or common install locations");
}

interface IssueDetail {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    user: { id: string; name: string } | null;
  }>;
}

interface RawIssueDetail {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user: { id: string; name: string } | null;
    }>;
  };
}

const ISSUE_DETAIL_QUERY = `
  query AgentIssueDetail($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      comments(first: 100, orderBy: createdAt) {
        nodes { id body createdAt user { id name } }
      }
    }
  }
`;

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

async function fetchIssueDetail(client: LinearClient, issueId: string): Promise<IssueDetail> {
  // Retry once on transient network errors. Linear (Cloudflare-fronted)
  // occasionally drops sockets; one retry covers ~all observed blips.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await client.client.rawRequest<
        { issue: RawIssueDetail | null },
        Record<string, unknown>
      >(ISSUE_DETAIL_QUERY, { id: issueId });
      if (!data || !data.issue) throw new Error(`issue ${issueId} not found`);
      const raw = data.issue;
      // Linear's `orderBy: createdAt` returns DESC (newest first). Downstream
      // code treats `comments[length-1]` as the latest and walks ascending
      // from a known cursor — so sort ASC here and let the rest of the file
      // operate on a chronological array.
      const comments = [...raw.comments.nodes].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      return {
        id: raw.id,
        identifier: raw.identifier,
        title: raw.title,
        description: raw.description,
        comments,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isTransientNetworkError(err)) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function newUserCommentsSince(
  detail: IssueDetail,
  lastCommentId: string | null,
): Array<{ id: string; body: string }> {
  const comments = detail.comments;
  let startIdx = 0;
  if (lastCommentId) {
    const idx = comments.findIndex((c) => c.id === lastCommentId);
    startIdx = idx === -1 ? 0 : idx + 1;
  }
  const out: Array<{ id: string; body: string }> = [];
  for (let i = startIdx; i < comments.length; i++) {
    const c = comments[i]!;
    const tag = parseAgentTag(c.body);
    if (tag && tag.role === "user") out.push({ id: c.id, body: c.body });
  }
  return out;
}

function sessionHasDoneComment(detail: IssueDetail): boolean {
  for (const c of detail.comments) {
    const tag = parseAgentTag(c.body);
    if (tag && tag.role === "agent" && tag.kind === "done") return true;
  }
  return false;
}

async function ensureWorktree(session: AgentSession, issue: IssueDetail): Promise<string> {
  if (session.worktreePath) return session.worktreePath;
  const short = session.id.slice(0, 8);
  const branch = `agent/${issue.identifier.toLowerCase()}-${short}`;
  const path = resolve(WORKTREES_DIR, `${issue.identifier}-${short}`);
  await mkdir(WORKTREES_DIR, { recursive: true });
  await runShell(`git worktree add -b ${branch} "${path}" main`, PROJECT_ROOT);
  return path;
}

function runShell(cmd: string, cwd: string): Promise<void> {
  return new Promise((resolveCmd, rejectCmd) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolveCmd();
      else rejectCmd(new Error(`'${cmd}' exited ${code}`));
    });
    child.on("error", rejectCmd);
  });
}

function buildInitialPrompt(issue: IssueDetail): string {
  return `You are an autonomous coding agent assigned to Linear issue ${issue.identifier}: ${issue.title}.

Description:
${issue.description ?? "(no description)"}

You are running headless inside a fresh git worktree (your current working directory is the worktree). The base branch is "main". A clean branch is checked out for you. The remote is the project's GitHub remote.

=== COMMUNICATION PROTOCOL (this is the ONLY way to talk to the user) ===

To post any message, run this shell command:
  curl -s -X POST "http://localhost:5173/api/issue/$AGENT_SESSION_ISSUE_ID/comment" \\
    -H "Content-Type: application/json" \\
    --data-binary @- <<JSON
{"body":"[agent:KIND] one-line summary\\n\\noptional multiline body"}
JSON

KIND ∈ { status | question | waiting-merge | done }
- \`status\`: progress updates — post several throughout the work
- \`question\`: you need user input; STOP after posting and wait silently
- \`waiting-merge\`: after \`gh pr create\`; STOP and wait
- \`done\`: AFTER you have merged; STOP

When the user replies, their messages will be injected into your input as a block starting with "USER REPLIED:" — continue from where you left off.

=== WORKFLOW ===
1. First action: post \`[agent:status] ack — <one-line plan>\`.
2. Implement the issue: edit files, commit, push the branch.
3. Open a PR with \`gh pr create --fill\` (or with a proper title/body).
4. Post \`[agent:waiting-merge] PR #N opened — <description>\` and STOP.
5. When user says "merge" (or "merge 吧" / "可以 merge"):
   - \`gh pr merge --squash --delete-branch\`
   - Move Linear issue to Done by PATCHing the OPUS team's Done state:
     curl -s -X PATCH "http://localhost:5173/api/issue/$AGENT_SESSION_ISSUE_ID" \\
       -H "Content-Type: application/json" \\
       -d '{"stateId":"e98c2654-8a4c-487f-b94e-c2f61c292744"}'
   - Post \`[agent:done] merged, closed ${issue.identifier}\` and STOP.

=== CONSTRAINTS ===
- Stay in the current worktree directory; do not cd elsewhere.
- Use only the curl-comment channel to talk back.
- AGENT_SESSION_ISSUE_ID env var is pre-set (UUID for ${issue.identifier}).
- After STOP-points, simply wait — do not loop or repeat.

Start now. Post your status ack, then begin work.`;
}

function buildResumeText(userMessages: Array<{ id: string; body: string }>): string {
  const joined = userMessages
    .map((m) => {
      const tag = parseAgentTag(m.body);
      const summary = tag?.summary ?? "";
      const freeform = tag?.freeform ? `\n${tag.freeform}` : "";
      return `[user:${tag?.kind ?? "?"}] ${summary}${freeform}`;
    })
    .join("\n\n---\n\n");
  return `USER REPLIED:\n\n${joined}\n\nContinue.`;
}

function writeAsPaste(pty: IPty, text: string): void {
  // Bracketed paste so multi-line content arrives as one "paste" event in
  // Claude's TUI input. The TUI shows it as "[Pasted text … +N lines]" in the
  // input field WITHOUT submitting; we then send Enter as a separate keystroke
  // ~500ms later so the TUI's paste-handler has time to commit before we fire
  // submit. (When \r is glued to the same write, it gets absorbed by the paste
  // handler and the message never submits.)
  pty.write(`\x1b[200~${text}\x1b[201~`);
  setTimeout(() => {
    try {
      pty.write("\r");
    } catch {
      // pty might have exited; ignore
    }
  }, 500);
}

async function appendLog(logPath: string, chunk: string): Promise<void> {
  try {
    await appendFile(logPath, chunk);
  } catch {
    // best-effort; never let logging break the flow
  }
}

export async function ensureAgentRunning(
  linearClient: LinearClient,
  session: AgentSession,
): Promise<void> {
  if (live.has(session.id)) return;
  if (session.status === "done" || session.status === "error") return;

  const issue = await fetchIssueDetail(linearClient, session.issueId);
  const worktreePath = await ensureWorktree(session, issue);
  if (worktreePath !== session.worktreePath) {
    await updateSession(session.id, { worktreePath });
  }

  const logPath = resolve(worktreePath, "_agent.log");
  await appendLog(logPath, `\n\n===== ${new Date().toISOString()} spawn =====\n`);

  const claudeBin = resolveClaudePath();
  // --dangerously-skip-permissions pairs with the user's global
  // skipDangerousModePermissionPrompt=true setting to start the TUI with no
  // permission dialogs at all. Without it claude shows a y/n confirmation
  // dialog at startup that intercepts our paste and crashes the session.
  //
  // --setting-sources project,local explicitly excludes the user's global
  // ~/.claude/settings.json. The user's file currently has several non-
  // standard hook keys (PermissionRequest / PostCompact / StopFailure / …)
  // that Claude flags at startup with a "Settings Error" dialog — same
  // crash-on-paste failure mode. OAuth auth tokens are stored separately
  // (keychain / ~/.claude/.credentials), so this only drops plugin /
  // statusLine / language prefs the agent doesn't need anyway.
  const pty = nodePty.spawn(
    claudeBin,
    [
      "--dangerously-skip-permissions",
      "--setting-sources", "project,local",
    ],
    {
      name: "xterm-256color",
      cols: 200,
      rows: 60,
      cwd: worktreePath,
      env: {
        ...process.env,
        AGENT_SESSION_ISSUE_ID: session.issueId,
        // Force claude to use OAuth (not API key), regardless of what other
        // env vars are set. The user is on Max20x; never read API key here.
        ANTHROPIC_API_KEY: "",
      },
    },
  );

  const record: LiveAgent = { sessionId: session.id, pty, logPath, exiting: false };
  live.set(session.id, record);

  pty.onData((chunk: string) => {
    void appendLog(logPath, chunk);
  });

  pty.onExit(({ exitCode }) => {
    console.log(
      `[agent-poller] ${session.id.slice(0, 8)} pty exited code=${exitCode} (exiting=${record.exiting})`,
    );
    live.delete(session.id);
    void appendLog(logPath, `\n===== exit code=${exitCode} =====\n`);
    // Status transition: if we initiated the exit (via /exit after [agent:done])
    // we leave the status at whatever it already is (done set by tick). Otherwise
    // the process crashed — mark as error.
    if (!record.exiting) {
      void updateSession(session.id, { status: "error" }).catch(() => {});
    }
  });

  console.log(`[agent-poller] ${session.id.slice(0, 8)} spawned in ${worktreePath}`);

  const initialPrompt = buildInitialPrompt(issue);
  setTimeout(() => {
    if (!live.has(session.id)) return;
    void appendLog(logPath, `\n----- WRITE initial prompt -----\n`);
    writeAsPaste(pty, initialPrompt);
  }, POST_SPAWN_DELAY_MS);
}

export async function stopAgent(sessionId: string): Promise<void> {
  const rec = live.get(sessionId);
  if (!rec) return;
  rec.exiting = true;
  try {
    rec.pty.write("/exit\r");
  } catch {
    // ignore
  }
  setTimeout(() => {
    const still = live.get(sessionId);
    if (still) {
      try {
        still.pty.kill();
      } catch {
        // ignore
      }
    }
  }, EXIT_GRACE_MS);
}

async function tickSession(linearClient: LinearClient, session: AgentSession): Promise<void> {
  const rec = live.get(session.id);
  if (!rec) return; // orphaned; user must restart

  const issue = await fetchIssueDetail(linearClient, session.issueId);

  if (sessionHasDoneComment(issue) && !rec.exiting) {
    console.log(`[agent-poller] ${session.id.slice(0, 8)} [agent:done] detected — exiting agent`);
    await updateSession(session.id, { status: "done" });
    await stopAgent(session.id);
    return;
  }

  // Update status based on latest agent comment (waiting-merge / question)
  let lastAgentKind: string | null = null;
  for (let i = issue.comments.length - 1; i >= 0; i--) {
    const t = parseAgentTag(issue.comments[i]!.body);
    if (t && t.role === "agent") {
      lastAgentKind = t.kind;
      break;
    }
  }
  if (lastAgentKind === "waiting-merge" && session.status !== "waiting-merge") {
    await updateSession(session.id, { status: "waiting-merge" });
  } else if (lastAgentKind === "question" && session.status !== "waiting-input") {
    await updateSession(session.id, { status: "waiting-input" });
  } else if (
    lastAgentKind &&
    lastAgentKind !== "waiting-merge" &&
    lastAgentKind !== "question" &&
    lastAgentKind !== "done" &&
    session.status !== "running"
  ) {
    await updateSession(session.id, { status: "running" });
  }

  // Forward new user messages into the live PTY.
  const newMsgs = newUserCommentsSince(issue, session.lastCommentId);
  if (newMsgs.length === 0) return;

  const latestId = issue.comments[issue.comments.length - 1]!.id;
  const text = buildResumeText(newMsgs);
  console.log(
    `[agent-poller] ${session.id.slice(0, 8)} forwarding ${newMsgs.length} user msg(s) → pty`,
  );
  void appendLog(rec.logPath, `\n----- WRITE resume (${newMsgs.length} msg) -----\n`);
  writeAsPaste(rec.pty, text);
  await updateSession(session.id, { lastCommentId: latestId, status: "running" });
}

async function tick(linearClient: LinearClient): Promise<void> {
  const sessions = await listSessions();
  for (const session of sessions) {
    if (session.status === "done" || session.status === "error") continue;
    try {
      await tickSession(linearClient, session);
    } catch (err) {
      console.error(`[agent-poller] tickSession ${session.id} failed:`, err);
    }
  }
}

async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  // Any session that was running before this process started is orphaned now;
  // its PTY died with the previous dev server. Mark all such as error.
  const sessions = await listSessions();
  for (const s of sessions) {
    if (s.status === "running" || s.status === "waiting-input" || s.status === "waiting-merge") {
      await updateSession(s.id, { status: "error" }).catch(() => {});
      console.log(`[agent-poller] bootstrap marked orphan session ${s.id.slice(0, 8)} → error`);
    }
  }
}

export function startAgentPoller(linearClient: LinearClient): void {
  if (timer) return;
  console.log("[agent-poller] starting, interval", POLL_INTERVAL_MS, "ms");
  void bootstrap();
  timer = setInterval(() => {
    tick(linearClient).catch((err) => console.error("[agent-poller] tick failed:", err));
  }, POLL_INTERVAL_MS);
}

export function isAgentLive(sessionId: string): boolean {
  return live.has(sessionId);
}

// Re-export for the linearApiPlugin to call from the start endpoint.
export { getSession };
