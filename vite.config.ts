import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { linearApiPlugin } from "./src/server/linearApiPlugin";

export default defineConfig({
  plugins: [react(), linearApiPlugin()],
});
