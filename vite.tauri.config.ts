import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Vite config used when serving / building for the Tauri shell.
//
// Differs from `vite.config.ts` in one important way: it does NOT load
// `linearApiPlugin`. That plugin embeds a Node HTTP server (board store,
// Linear proxy, claude-agent poller) into Vite's dev middleware — useful for
// the browser-only `npm run dev` workflow, but redundant under Tauri because
// the same surface is served by Rust commands via `src/lib/tauriBridge.ts`.
// Skipping it here also keeps `node-pty` out of `vite build`'s import graph
// so the production bundle stays lean.
//
// `@linear/sdk` used to be lazily imported from `tauriBridge.ts`, but Linear
// API calls now go through Rust (`src-tauri/src/linear.rs`), so the SDK is
// dead weight in the Tauri build. Aliasing it to a tiny stub means Vite still
// resolves the `import type LinearClient` references the source files keep
// for hover-doc/legacy reasons, but doesn't emit the ~2MB lazy chunk that
// used to crash the webview on init.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@linear/sdk": path.resolve(here, "src/lib/linearSdkStub.ts"),
    },
  },
  // Tauri 2.x defaults: bind to 1420 so the `tauri.conf.json::devUrl` matches.
  // Use strictPort so a stray dev server doesn't silently shadow this one.
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/worktrees/**"],
    },
  },
});
