import { useCallback, useEffect, useRef, useState } from "react";
import {
  VIEWS_ENDPOINT,
  deleteViewBoard,
  formatDefaultViewName,
  loadManifest,
  saveManifest,
  uniqueName,
  viewBoardEndpoint,
  type ViewMeta,
  type ViewsManifest,
} from "./workingOnViews";
import { saveBoardData } from "./workingOn";
import { shortId } from "./workingOn";

export interface UseWorkingOnViews {
  manifest: ViewsManifest | null;
  loaded: boolean;
  activeId: string | null;
  boardEndpoint: string | null;
  setActiveId: (id: string) => void;
  createView: (name?: string) => Promise<string | null>;
  renameView: (id: string, name: string) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
}

export function useWorkingOnViews(onError?: (e: unknown) => void): UseWorkingOnViews {
  const [manifest, setManifest] = useState<ViewsManifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadManifest();
        if (cancelled) return;
        // Boot override — open the most-recently-created view regardless of
        // what was persisted as `activeId`. The on-disk activeId is left
        // untouched; setActiveId persists the user's intra-session choice
        // but the next boot still defaults to the latest view (matches the
        // user's "create-a-view-per-day, default to today" workflow).
        const latest =
          m.views.length > 0
            ? [...m.views].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
            : null;
        const boot = latest && latest.id !== m.activeId ? { ...m, activeId: latest.id } : m;
        setManifest(boot);
        setLoaded(true);
      } catch (e) {
        console.error(`[useWorkingOnViews] load failed`, e);
        onErrorRef.current?.(e);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: ViewsManifest): Promise<ViewsManifest | null> => {
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      return saved;
    } catch (e) {
      console.error(`[useWorkingOnViews] save failed`, e);
      onErrorRef.current?.(e);
      return null;
    }
  }, []);

  const setActiveId = useCallback(
    (id: string) => {
      // Read current state outside the updater — side effects inside React
      // setState updaters get double-invoked in StrictMode and are an anti-pattern.
      const current = manifest;
      if (!current || !current.views.some((v) => v.id === id) || current.activeId === id) return;
      const next: ViewsManifest = { ...current, activeId: id };
      setManifest(next);
      saveManifest(next).catch((e) => {
        console.error(`[useWorkingOnViews] setActive save failed`, e);
        onErrorRef.current?.(e);
      });
    },
    [manifest],
  );

  const createView = useCallback(
    async (name?: string): Promise<string | null> => {
      const current = manifest;
      if (!current) return null;
      const id = shortId("wov");
      const desired = name?.trim() || formatDefaultViewName();
      const finalName = uniqueName(desired, current.views.map((v) => v.name));
      const meta: ViewMeta = { id, name: finalName, createdAt: new Date().toISOString() };
      // Create empty board first so the GET after activation doesn't 404.
      try {
        await saveBoardData(viewBoardEndpoint(id), { issueMembers: {}, noteNodes: [], edges: [], groups: [] });
      } catch (e) {
        console.error(`[useWorkingOnViews] create board failed`, e);
        onErrorRef.current?.(e);
        return null;
      }
      const next: ViewsManifest = {
        views: [...current.views, meta],
        activeId: id,
      };
      const saved = await persist(next);
      return saved ? id : null;
    },
    [manifest, persist],
  );

  const renameView = useCallback(
    async (id: string, name: string): Promise<void> => {
      const current = manifest;
      if (!current) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const others = current.views.filter((v) => v.id !== id).map((v) => v.name);
      const finalName = uniqueName(trimmed, others);
      const next: ViewsManifest = {
        ...current,
        views: current.views.map((v) => (v.id === id ? { ...v, name: finalName } : v)),
      };
      await persist(next);
    },
    [manifest, persist],
  );

  const deleteView = useCallback(
    async (id: string): Promise<void> => {
      const current = manifest;
      if (!current) return;
      if (current.views.length <= 1) return; // UI also gates, but defend.
      const remaining = current.views.filter((v) => v.id !== id);
      const newActive = current.activeId === id ? remaining[0]!.id : current.activeId;
      const next: ViewsManifest = { views: remaining, activeId: newActive };
      const saved = await persist(next);
      if (saved) {
        try {
          await deleteViewBoard(id);
        } catch (e) {
          console.warn(`[useWorkingOnViews] board file delete failed (manifest already updated)`, e);
        }
      }
    },
    [manifest, persist],
  );

  const activeId = manifest?.activeId ?? null;
  const boardEndpoint = activeId ? viewBoardEndpoint(activeId) : null;

  // Reading VIEWS_ENDPOINT keeps the import non-orphaned and lets dev tools
  // verify the path constant is in use.
  void VIEWS_ENDPOINT;

  return {
    manifest,
    loaded,
    activeId,
    boardEndpoint,
    setActiveId,
    createView,
    renameView,
    deleteView,
  };
}
