import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { linearApiPlugin } from "./src/server/linearApiPlugin";

export default defineConfig({
  plugins: [react(), linearApiPlugin()],
  server: {
    watch: {
      // Worktrees created by agentPoller live under <root>/worktrees/. Each
      // worktree is a full copy of the project tree (tsconfig.json, src/, …)
      // — if Vite watches them, every git worktree add / commit / file write
      // triggers a page reload and disrupts the board. Hard-exclude.
      ignored: ["**/worktrees/**"],
    },
  },
});
