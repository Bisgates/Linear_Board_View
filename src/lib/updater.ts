// In-app auto-updater wrapper.
//
// Thin façade around `@tauri-apps/plugin-updater` so the React UI doesn't have
// to know about plugin internals. Only meaningful in the Tauri runtime — call
// sites must gate on `isTauri()` from `./tauriInvoke` before touching anything
// here. The dynamic imports below also guarantee that the plugin's JS is never
// pulled into the browser bundle's eager paths (no `window.__TAURI_INTERNALS__`
// → `check()` is never invoked → tree-shaker keeps the deps dormant).
//
// The plugin endpoint + signing key are configured in `src-tauri/tauri.conf.json`
// under `plugins.updater`. Manifest format is the standard Tauri v2 schema
// (`version` / `notes` / `pub_date` / `platforms.<target>.{signature,url}`).

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string | null;
  date?: string | null;
}

export type DownloadProgress = {
  kind: "started";
  contentLength: number | null;
} | {
  kind: "progress";
  downloaded: number;
  total: number | null;
} | {
  kind: "finished";
};

export interface CheckResult {
  available: boolean;
  info?: UpdateInfo;
  // Handle to the live `Update` object — opaque to callers, passed back into
  // `runInstall()` when the user clicks "Install". Keeping the object alive
  // between check and install avoids a second network round-trip.
  handle?: unknown;
}

export async function checkForUpdate(): Promise<CheckResult> {
  const { check } = await import("@tauri-apps/plugin-updater");
  // proxy hardcoded — .app processes don't inherit shell HTTPS_PROXY, and
  // GitHub is unreachable from this machine without going through Clash on
  // 7890. Localhost-only so no leak risk; revisit if dev moves off Clash.
  // 30s timeout — Tauri's check() will hang silently if the proxy is down.
  const update = await Promise.race([
    check({ timeout: 30_000, proxy: "http://127.0.0.1:7890" }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("check() timed out after 30s")), 30_000),
    ),
  ]) as Awaited<ReturnType<typeof check>>;
  if (!update) {
    // `check()` returns `null` when the running version >= the manifest's
    // version (i.e. already up-to-date).
    return { available: false };
  }
  return {
    available: true,
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
      date: update.date ?? null,
    },
    handle: update,
  };
}

export async function runInstall(
  handle: unknown,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  // The handle is the `Update` object returned by `check()`. We use
  // `downloadAndInstall(callback)` which streams progress events synchronously
  // while the download runs. After install, `relaunch()` from
  // `@tauri-apps/plugin-process` restarts the app into the new bundle.
  const u = handle as {
    downloadAndInstall: (
      cb: (event: {
        event: "Started" | "Progress" | "Finished";
        data?: { contentLength?: number; chunkLength?: number };
      }) => void,
    ) => Promise<void>;
  };

  let downloaded = 0;
  let total: number | null = null;
  await u.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data?.contentLength ?? null;
      onProgress({ kind: "started", contentLength: total });
    } else if (event.event === "Progress") {
      const chunk = event.data?.chunkLength ?? 0;
      downloaded += chunk;
      onProgress({ kind: "progress", downloaded, total });
    } else if (event.event === "Finished") {
      onProgress({ kind: "finished" });
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
