import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri, readPinnedTabs, writePinnedTabs } from "./tauriInvoke";

// Legacy storage key — used only for one-time migration when the app upgrades
// from a version that kept pinned-tab order in WebKit localStorage. WebKit
// per-bundle storage can be wiped when the .app is replaced (which is what
// happens on every `npm run release`), so the authoritative store now lives
// on disk under the app's data dir — see `read_pinned_tabs` in Rust.
const LEGACY_STORAGE_KEY = "linear_board_view:pinned_tabs:v1";

interface LegacyShape {
  order: string[];
}

function loadLegacyOrder(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyShape;
    if (!parsed || !Array.isArray(parsed.order)) return [];
    return parsed.order.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function clearLegacyOrder(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

export interface UsePinnedTabs {
  /** Order reconciled against existing custom view ids. */
  order: string[];
  isPinned: (viewId: string) => boolean;
  pin: (viewId: string) => void;
  unpin: (viewId: string) => void;
  reorder: (fromIdx: number, toIdx: number) => void;
}

/**
 * Reconciles a persisted ordered list of custom-view ids against the live
 * list, dropping ids whose view no longer exists. Labels are NOT stored — the
 * caller looks them up from `existingIds` so renames propagate automatically.
 *
 * Persistence lives on disk (`<app_data>/data/pinned_tabs.json`) rather than
 * localStorage so the pinned strip survives app-bundle replacement (which can
 * wipe per-bundle WebKit storage on macOS). On first run we migrate any
 * legacy localStorage value into the on-disk store, then clear the localStorage
 * entry so it can't drift.
 */
export function usePinnedTabs(existingIds: string[]): UsePinnedTabs {
  const [order, setOrder] = useState<string[]>([]);
  // We don't want to write the empty initial state back to disk before the
  // hydration finishes — that would erase the on-disk list when the existingIds
  // prop arrives empty on first render. Gate all writes behind a `hydrated`
  // flag flipped only after `readPinnedTabs()` resolves.
  const hydratedRef = useRef(false);

  // Async hydration on mount. If the disk store is empty AND localStorage has
  // a legacy entry, seed disk from it (one-time migration), then drop the
  // legacy key so it can't drift apart from disk.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      let initial: string[] = [];
      if (isTauri()) {
        try {
          const payload = await readPinnedTabs();
          initial = Array.isArray(payload?.order)
            ? payload.order.filter((s): s is string => typeof s === "string")
            : [];
        } catch {
          initial = [];
        }
      }
      // Migration path: nothing on disk yet but legacy localStorage entry
      // exists — port it across once and write back to disk.
      if (initial.length === 0) {
        const legacy = loadLegacyOrder();
        if (legacy.length > 0) {
          initial = legacy;
          if (isTauri()) {
            try {
              await writePinnedTabs(initial);
            } catch {
              // best-effort — if the write fails we'll retry next session
            }
          }
        }
      }
      // Always clear the legacy key after hydration so a stale browser cache
      // can never overwrite a freshly-edited on-disk list.
      clearLegacyOrder();
      if (cancelled) return;
      hydratedRef.current = true;
      if (initial.length > 0) setOrder(initial);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const existingSet = useMemo(() => new Set(existingIds), [existingIds]);

  const reconciled = useMemo(() => {
    let mutated = false;
    const out: string[] = [];
    for (const id of order) {
      if (existingSet.has(id)) out.push(id);
      else mutated = true;
    }
    return mutated ? out : order;
  }, [order, existingSet]);

  // If reconciliation dropped any ids, persist the cleaned list so we don't
  // re-process the orphan on every render. Guard the setState behind the
  // identity check so we don't loop, and behind hydratedRef so we don't write
  // back the empty initial state before hydration has run.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (reconciled !== order) {
      setOrder(reconciled);
      if (isTauri()) {
        void writePinnedTabs(reconciled).catch(() => {
          /* best-effort — the in-memory order still wins this session */
        });
      }
    }
  }, [reconciled, order]);

  const persist = useCallback((next: string[]) => {
    if (!isTauri()) return;
    void writePinnedTabs(next).catch(() => {
      /* best-effort — log nothing; user sees in-memory state regardless */
    });
  }, []);

  const isPinned = useCallback((id: string) => reconciled.includes(id), [reconciled]);

  const pin = useCallback(
    (id: string) => {
      setOrder((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const unpin = useCallback(
    (id: string) => {
      setOrder((prev) => {
        if (!prev.includes(id)) return prev;
        const next = prev.filter((x) => x !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reorder = useCallback(
    (fromIdx: number, toIdx: number) => {
      setOrder((prev) => {
        if (fromIdx < 0 || fromIdx >= prev.length) return prev;
        if (toIdx < 0 || toIdx > prev.length) return prev;
        if (fromIdx === toIdx) return prev;
        const arr = [...prev];
        const [moved] = arr.splice(fromIdx, 1);
        const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
        arr.splice(insertAt, 0, moved!);
        persist(arr);
        return arr;
      });
    },
    [persist],
  );

  return { order: reconciled, isPinned, pin, unpin, reorder };
}
