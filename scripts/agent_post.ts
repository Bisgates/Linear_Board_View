/**
 * agent_post — thin CLI for an in-session agent to talk back via Linear comments.
 *
 * Usage:
 *   AGENT_SESSION_ISSUE_ID=<linear-issue-uuid> tsx scripts/agent_post.ts <kind> <summary> [body...]
 *
 *   <kind>     one of: status | question | waiting-merge | done
 *   <summary>  one-line summary; must not contain newlines
 *   [body]     optional remaining args joined with spaces as freeform body
 *
 * Posts a `[agent:<kind>] <summary>` comment to the issue. Reads
 * LINEAR_API_KEY from .env / env.
 */
import "dotenv/config";
import { LinearClient } from "@linear/sdk";
import { createIssueComment } from "../src/linear/createComment.js";
import { formatAgentTag, type AgentKind } from "../src/lib/agentProtocol.js";

const VALID_KINDS: AgentKind[] = ["status", "question", "waiting-merge", "done"];

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("agent_post: LINEAR_API_KEY missing");
  process.exit(1);
}

const issueId = process.env.AGENT_SESSION_ISSUE_ID;
if (!issueId) {
  console.error("agent_post: AGENT_SESSION_ISSUE_ID env var required");
  process.exit(1);
}

const [, , kindArg, summary, ...bodyParts] = process.argv;
if (!kindArg || !summary) {
  console.error("agent_post: usage: agent_post <kind> <summary> [body...]");
  process.exit(1);
}
if (!(VALID_KINDS as string[]).includes(kindArg)) {
  console.error(`agent_post: invalid kind "${kindArg}". One of: ${VALID_KINDS.join(", ")}`);
  process.exit(1);
}

const freeform = bodyParts.length > 0 ? bodyParts.join(" ") : null;
const body = formatAgentTag("agent", kindArg as AgentKind, summary, freeform);

const client = new LinearClient({ apiKey });

createIssueComment(client, issueId, body)
  .then((c) => {
    console.log(c.id);
  })
  .catch((err) => {
    console.error("agent_post: failed", err);
    process.exit(1);
  });
