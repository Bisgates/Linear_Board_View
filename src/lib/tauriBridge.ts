// Tauri runtime bridge.
//
// When the app runs inside a Tauri webview there is no Vite dev server and no
// `/api/...` HTTP routes. Rather than fork every fetch site in the codebase we
// patch the global `fetch` so requests to `/api/*` and `/data/issues.json`
// transparently dispatch to Tauri commands (defined in `src-tauri/src/lib.rs`
// and `src-tauri/src/linear.rs`).
//
// The shim is a no-op in the browser (`installTauriBridge` returns false), so
// `npm run dev` behaviour is preserved untouched.
//
// Linear API calls (refetch / update / comment) used to be made client-side
// via dynamic `import("@linear/sdk")`. That SDK pulls Node-only shims
// (stream/http/url/https/crypto/zlib) which Vite externalises to stubs — fine
// in a real browser, but the Tauri webview crashes when those stubs are
// touched. We now invoke Tauri commands that issue GraphQL requests from
// Rust, removing the SDK from the runtime path entirely.

import { invoke } from "@tauri-apps/api/core";
import type { IssuePatch } from "../linear/updateIssue";
import type { IssueRecord, CommentRecord } from "../linear/types";
import type { WorkflowState } from "../linear/fetchWorkflowStates";

const AGENT_DISABLED_MSG =
  "Agent management disabled in Tauri build (pending native pty migration)";

export function isTauri(): boolean {
  // Tauri 2.x sets `__TAURI_INTERNALS__` on `window` when the page is loaded
  // by its webview. The older `window.__TAURI__` is also kept for
  // back-compat — check both to be safe.
  const w = globalThis as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

interface RouteResponse {
  status: number;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function dispatch(
  method: string,
  path: string,
  body: unknown,
): Promise<RouteResponse> {
  // --- Snapshot ---
  if (path === "/data/issues.json" && method === "GET") {
    const data = await invoke<unknown>("read_issues_snapshot");
    return { status: 200, body: data };
  }

  // --- Refetch — pull issues + workflow states from Rust GraphQL client,
  //     then persist the snapshot. The Rust side does its own pagination, so
  //     we just await both invokes in parallel. ---
  if (path === "/api/refetch" && method === "GET") {
    const start = Date.now();
    try {
      const [issuesResult, workflowStates] = await Promise.all([
        invoke<{ issues: IssueRecord[]; pages: number }>("linear_fetch_all_issues"),
        invoke<WorkflowState[]>("linear_fetch_workflow_states"),
      ]);
      const { issues, pages } = issuesResult;
      const elapsedMs = Date.now() - start;
      const fetchedAt = new Date().toISOString();
      const snapshot = {
        fetchedAt,
        count: issues.length,
        pages,
        elapsedMs,
        issues,
        meta: { workflowStates },
      };
      await invoke("write_issues_snapshot", { snapshot });
      return {
        status: 200,
        body: {
          ok: true,
          count: issues.length,
          pages,
          elapsedMs,
          fetchedAt,
          workflowStateCount: workflowStates.length,
        },
      };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Working On (day) manifest ---
  const dayManifest = stripQuery(path) === "/api/working-on/views";
  if (dayManifest && method === "GET") {
    const data = await invoke<unknown>("read_day_manifest");
    return { status: 200, body: data };
  }
  if (dayManifest && method === "PUT") {
    try {
      const saved = await invoke<unknown>("write_day_manifest", { manifest: body });
      return { status: 200, body: { ok: true, data: saved } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Working On per-view ---
  const dayViewMatch = /^\/api\/working-on\/views\/([^/?#]+)/.exec(path);
  if (dayViewMatch) {
    const viewId = decodeURIComponent(dayViewMatch[1]!);
    if (method === "GET") {
      try {
        const data = await invoke<unknown>("read_day_view_board", { viewId });
        return { status: 200, body: data };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
    if (method === "PUT") {
      try {
        const saved = await invoke<unknown>("write_day_view_board", {
          viewId,
          data: body,
        });
        return { status: 200, body: { ok: true, data: saved } };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
    if (method === "DELETE") {
      try {
        await invoke("delete_day_view_board", { viewId });
        return { status: 200, body: { ok: true } };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
  }

  // --- Custom manifest ---
  const customManifest = stripQuery(path) === "/api/custom/views";
  if (customManifest && method === "GET") {
    const data = await invoke<unknown>("read_custom_manifest");
    return { status: 200, body: data };
  }
  if (customManifest && method === "PUT") {
    try {
      const saved = await invoke<unknown>("write_custom_manifest", { manifest: body });
      return { status: 200, body: { ok: true, data: saved } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Custom per-view ---
  const customViewMatch = /^\/api\/custom\/views\/([^/?#]+)/.exec(path);
  if (customViewMatch) {
    const viewId = decodeURIComponent(customViewMatch[1]!);
    if (method === "GET") {
      try {
        const data = await invoke<unknown>("read_custom_view_board", { viewId });
        return { status: 200, body: data };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
    if (method === "PUT") {
      try {
        const saved = await invoke<unknown>("write_custom_view_board", {
          viewId,
          data: body,
        });
        return { status: 200, body: { ok: true, data: saved } };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
    if (method === "DELETE") {
      try {
        await invoke("delete_custom_view_board", { viewId });
        return { status: 200, body: { ok: true } };
      } catch (err) {
        return { status: 500, body: { ok: false, error: String(err) } };
      }
    }
  }

  // --- Legacy /api/working-on read returns the active view's board. ---
  if (path === "/api/working-on" && method === "GET") {
    try {
      const manifest = (await invoke<{ activeId: string }>("read_day_manifest"));
      const data = await invoke<unknown>("read_day_view_board", {
        viewId: manifest.activeId,
      });
      return { status: 200, body: data };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- All-issues board ---
  if (path === "/api/all-issues-board" && method === "GET") {
    const data = await invoke<unknown>("read_all_issues_board");
    return { status: 200, body: data };
  }
  if (path === "/api/all-issues-board" && method === "PUT") {
    try {
      const saved = await invoke<unknown>("write_all_issues_board", { data: body });
      return { status: 200, body: { ok: true, data: saved } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Open ---
  if (path === "/api/open" && method === "POST") {
    try {
      const b = (body ?? {}) as { path?: string };
      if (!b.path) return { status: 400, body: { ok: false, error: "missing path" } };
      await invoke("open_path", { path: b.path });
      return { status: 200, body: { ok: true } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Linear issue mutations — Rust GraphQL client. ---
  const commentMatch = /^\/api\/issue\/([^/?#]+)\/comment(?:\?|#|$)/.exec(path);
  if (commentMatch && method === "POST") {
    const issueId = commentMatch[1]!;
    try {
      const b = (body ?? {}) as { body?: string };
      if (typeof b.body !== "string" || b.body.length === 0) {
        return { status: 400, body: { ok: false, error: "missing body" } };
      }
      const comment = await invoke<CommentRecord>("linear_create_issue_comment", {
        issueId,
        body: b.body,
      });
      return { status: 200, body: { ok: true, comment } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  const patchMatch = /^\/api\/issue\/([^/?#]+)/.exec(path);
  if (patchMatch && method === "PATCH") {
    const id = patchMatch[1]!;
    try {
      const issue = await invoke<IssueRecord>("linear_update_issue", {
        id,
        patch: body as IssuePatch,
      });
      return { status: 200, body: { ok: true, issue } };
    } catch (err) {
      return { status: 500, body: { ok: false, error: String(err) } };
    }
  }

  // --- Agent endpoints — stubbed. We deliberately return success on
  // list-sessions (empty array) so the existing polling hook keeps quiet, but
  // start/stop fail loudly with a human-readable disabled reason so the UI
  // can surface a toast if the user pokes a button. ---
  if (path === "/api/agent/sessions" && method === "GET") {
    return { status: 200, body: { ok: true, sessions: [] } };
  }
  if (path === "/api/agent/start" && method === "POST") {
    return { status: 503, body: { ok: false, error: AGENT_DISABLED_MSG } };
  }
  const stopMatch = /^\/api\/agent\/([^/?#]+)\/stop(?:\?|#|$)/.exec(path);
  if (stopMatch && method === "POST") {
    return { status: 503, body: { ok: false, error: AGENT_DISABLED_MSG } };
  }

  return { status: 404, body: { ok: false, error: `no route for ${method} ${path}` } };
}

function stripQuery(p: string): string {
  const i = p.indexOf("?");
  return i === -1 ? p : p.slice(0, i);
}

function isBridgedUrl(url: string): boolean {
  // Bridge only same-origin paths that match Vite's `/api/*` or
  // `/data/issues.json` namespace. Anything else (CDN icons, third-party,
  // etc.) keeps going through the webview's native fetch.
  if (url.startsWith("/api/") || url === "/api/working-on") return true;
  if (url === "/data/issues.json") return true;
  return false;
}

export function installTauriBridge(): boolean {
  if (!isTauri()) return false;
  const native = globalThis.fetch.bind(globalThis);
  const patched: typeof fetch = async (input, init) => {
    let url: string;
    let method: string;
    let body: unknown;
    if (typeof input === "string") {
      url = input;
      method = (init?.method ?? "GET").toUpperCase();
      body = init?.body;
    } else if (input instanceof URL) {
      url = input.toString();
      method = (init?.method ?? "GET").toUpperCase();
      body = init?.body;
    } else {
      // Request object
      url = input.url;
      method = input.method.toUpperCase();
      body = await input.clone().text();
    }

    // Normalise absolute URLs from the Tauri custom scheme back to a path.
    // In Tauri 2 the webview origin is something like `tauri://localhost` or
    // `https://tauri.localhost` — strip it down to a relative path so the
    // route table below stays clean.
    const normalised = toPath(url);
    if (!isBridgedUrl(normalised)) {
      return native(input, init);
    }

    let parsed: unknown = body;
    if (typeof body === "string" && body.length > 0) {
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
    } else if (body == null) {
      parsed = undefined;
    }
    const { status, body: respBody } = await dispatch(method, normalised, parsed);
    return jsonResponse(status, respBody);
  };
  globalThis.fetch = patched;
  console.log("[tauriBridge] installed");
  return true;
}

function toPath(url: string): string {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}
