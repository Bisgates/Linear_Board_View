// Stub for `@linear/sdk` — used in the Tauri build only.
//
// `vite.tauri.config.ts` aliases `@linear/sdk` to this file so the heavy
// Node-shim-laden real SDK never enters the bundle. Linear API calls in the
// Tauri build now go through Rust (`src-tauri/src/linear.rs`); the remaining
// references to `LinearClient` in `src/linear/*.ts` exist for the Node /
// browser dev path (`src/server/linearApiPlugin.ts` runs there), but those
// files are dead code in the Tauri build. Exporting a no-op class makes
// Vite's resolver happy without dragging in the real package.
//
// If anything in the Tauri runtime actually constructs a `LinearClient` from
// this stub, that's a regression — throw loudly so we hear about it.

export class LinearClient {
  // Match the constructor signature `new LinearClient({ apiKey })` so any
  // type-only consumers compile, but reject runtime construction.
  constructor(_opts: { apiKey: string }) {
    throw new Error(
      "@linear/sdk is stubbed in the Tauri build. Use Tauri commands `linear_*` instead (src-tauri/src/linear.rs).",
    );
  }
  // Some call sites read `.client.rawRequest(...)`. Same loud failure.
  get client(): never {
    throw new Error(
      "@linear/sdk is stubbed in the Tauri build. Use Tauri commands `linear_*` instead.",
    );
  }
}

// Re-export under both default and named symbols in case the bundle hits
// either form during type resolution.
export default LinearClient;
