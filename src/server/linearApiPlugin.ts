import "dotenv/config";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { LinearClient } from "@linear/sdk";
import { fetchAllIssues } from "../linear/fetchIssues.js";
import { updateIssue, type IssuePatch } from "../linear/updateIssue.js";
import { fetchAllWorkflowStates } from "../linear/fetchWorkflowStates.js";
import { readWorkingOn, writeWorkingOn } from "./workingOnStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function linearApiPlugin(): Plugin {
  const apiKey = process.env.LINEAR_API_KEY;
  let client: LinearClient | null = null;
  if (apiKey) client = new LinearClient({ apiKey });

  const snapshotPath = resolve(__dirname, "..", "..", "public", "data", "issues.json");

  return {
    name: "linear-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";

        // GET /api/working-on  (no Linear client required — local file only)
        if (url === "/api/working-on" && req.method === "GET") {
          try {
            const data = await readWorkingOn();
            return sendJson(res, 200, data);
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err) });
          }
        }
        // PUT /api/working-on
        if (url === "/api/working-on" && req.method === "PUT") {
          try {
            const body = await readJson(req);
            const saved = await writeWorkingOn(body);
            return sendJson(res, 200, { ok: true, data: saved });
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err) });
          }
        }

        // POST /api/open — launch a local file / URL via the OS opener.
        // Dev-only (apply: "serve") + localhost-bound by Vite, so the auth surface
        // is the same as having shell access to this user account.
        if (url === "/api/open" && req.method === "POST") {
          try {
            const body = (await readJson(req)) as { path?: string };
            if (typeof body.path !== "string" || !body.path) {
              return sendJson(res, 400, { ok: false, error: "missing path" });
            }
            const opener =
              platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
            const child = spawn(opener, [body.path], { stdio: "ignore", detached: true });
            child.unref();
            return sendJson(res, 200, { ok: true });
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err) });
          }
        }

        if (!client) {
          if (url.startsWith("/api/")) {
            return sendJson(res, 500, { error: "LINEAR_API_KEY not set" });
          }
          return next();
        }

        // GET /api/refetch
        if (url === "/api/refetch" && req.method === "GET") {
          try {
            const start = Date.now();
            const [issuesResult, workflowStates] = await Promise.all([
              fetchAllIssues(client),
              fetchAllWorkflowStates(client),
            ]);
            const { issues, pages } = issuesResult;
            const elapsedMs = Date.now() - start;
            const snapshot = {
              fetchedAt: new Date().toISOString(),
              count: issues.length,
              pages,
              elapsedMs,
              issues,
              meta: { workflowStates },
            };
            await mkdir(dirname(snapshotPath), { recursive: true });
            await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
            return sendJson(res, 200, {
              ok: true,
              count: issues.length,
              pages,
              elapsedMs,
              fetchedAt: snapshot.fetchedAt,
              workflowStateCount: workflowStates.length,
            });
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err) });
          }
        }

        // PATCH /api/issue/:id
        const patchMatch = /^\/api\/issue\/([^/?#]+)/.exec(url);
        if (patchMatch && req.method === "PATCH") {
          const id = patchMatch[1]!;
          try {
            const body = (await readJson(req)) as IssuePatch;
            const issue = await updateIssue(client, id, body);
            return sendJson(res, 200, { ok: true, issue });
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err) });
          }
        }

        next();
      });
    },
  };
}
