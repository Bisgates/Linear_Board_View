import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Single Vite config for the Tauri-only runtime (v0.26.0+). The previous
// dual-stack era kept two configs — one for the browser dev server with a
// Node-side Linear API middleware, one for the Tauri shell — but the browser
// path was retired when Linear API moved to Rust. Everything the frontend
// needs now is reachable via `invoke()` against `src-tauri/src/lib.rs` and
// `src-tauri/src/linear.rs` (see `src/lib/tauriInvoke.ts`).

// Build-time guard added in v0.26.1: dual-stack era left a `public/data/` dir
// holding the dev mac's real Linear snapshot + view boards. Vite copies the
// whole `public/` tree into `dist/`, and Tauri then embeds `dist/` into the
// Rust binary via `frontendDist` — every release shipped baked-in dev data
// until 0.26.0. This plugin makes the same mistake impossible: any
// `public/data/*` regrowth aborts the build with a loud error.
function forbidPublicData(): Plugin {
  return {
    name: "forbid-public-data",
    apply: "build",
    buildStart() {
      const offender = path.join(here, "public", "data");
      if (existsSync(offender)) {
        this.error(
          `refused to build: ${offender} would be copied into the .app bundle and shipped to every user. Move that data to ~/Library/Application Support/com.han.linearboard/data/ and delete public/data/.`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), forbidPublicData()],
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
