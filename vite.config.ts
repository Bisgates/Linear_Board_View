import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single Vite config for the Tauri-only runtime (v0.26.0+). The previous
// dual-stack era kept two configs — one for the browser dev server with a
// Node-side Linear API middleware, one for the Tauri shell — but the browser
// path was retired when Linear API moved to Rust. Everything the frontend
// needs now is reachable via `invoke()` against `src-tauri/src/lib.rs` and
// `src-tauri/src/linear.rs` (see `src/lib/tauriInvoke.ts`).
export default defineConfig({
  plugins: [react()],
  // Tauri 2.x defaults: bind to 1420 so the `tauri.conf.json::devUrl` matches.
  // Use strictPort so a stray dev server doesn't silently shadow this one.
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Agent worktrees (when the agent feature is re-enabled atop Rust pty)
      // will live under <root>/worktrees/. Pre-exclude to avoid reload storms.
      ignored: ["**/worktrees/**"],
    },
  },
});
