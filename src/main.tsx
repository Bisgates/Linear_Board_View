import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { installTauriBridge } from "./lib/tauriBridge";
import App from "./App";

// Patch global fetch when running inside Tauri so `/api/*` and
// `/data/issues.json` requests are dispatched to native commands instead of
// the (non-existent) Vite dev server. No-op in the browser dev workflow.
installTauriBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
