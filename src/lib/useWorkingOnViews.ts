import { useCallback, useEffect, useRef, useState } from "react";
import {
  customViewsClient,
  dayViewsClient,
  formatDefaultViewName,
  nextCustomName,
  uniqueName,
  type ViewMeta,
  type ViewsClient,
  type ViewsManifest,
} from "./workingOnViews";
import { saveBoardData, shortId } from "./workingOn";

export interface UseViewsList {
  manifest: ViewsManifest | null;
  loaded: boolean;
  activeId: string | null;
  boardEndpoint: string | null;
  setActiveId: (id: string) => void;
  createView: (name?: string) => Promise<string | null>;
  renameView: (id: string, name: string) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
}

/**
 * Generic views-list state hook. Used by both Working On (day) and Custom.
 * `defaultName` decides what a freshly created view is called when the caller
 * doesn't pass an explicit name; `idPrefix` namespaces the short ids per kind
 * so backend logs stay readable.
 */
export function useViewsList(
  client: ViewsClient,
  opts: {
    defaultName: (existing: string[]) => string;
    idPrefix: string;
  },
  onError?: (e: unknown) => void,
): UseViewsList {
  const [manifest, setManifest] = useState<ViewsManifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const defaultNameRef = useRef(opts.defaultName);
  defaultNameRef.current = opts.defaultName;
  const idPrefix = opts.idPrefix;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await client.loadManifest();
        if (cancelled) return;
        // Boot override — open the most-recently-created view regardless of
        // what was persisted as `activeId`. Matches "create one per session,
        // default to the freshest" workflow for both kinds.
        const latest =
          m.views.length > 0
            ? [...m.views].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
            : null;
        const boot = latest && latest.id !== m.activeId ? { ...m, activeId: latest.id } : m;
        setManifest(boot);
        setLoaded(true);
      } catch (e) {
        console.error(`[useViewsList ${client.manifestEndpoint}] load failed`, e);
        onErrorRef.current?.(e);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const persist = useCallback(
    async (next: ViewsManifest): Promise<ViewsManifest | null> => {
      try {
        const saved = await client.saveManifest(next);
        setManifest(saved);
        return saved;
      } catch (e) {
        console.error(`[useViewsList ${client.manifestEndpoint}] save failed`, e);
        onErrorRef.current?.(e);
        return null;
      }
    },
    [client],
  );

  const setActiveId = useCallback(
    (id: string) => {
      const current = manifest;
      if (!current || !current.views.some((v) => v.id === id) || current.activeId === id) return;
      const next: ViewsManifest = { ...current, activeId: id };
      setManifest(next);
      client.saveManifest(next).catch((e) => {
        console.error(`[useViewsList ${client.manifestEndpoint}] setActive save failed`, e);
        onErrorRef.current?.(e);
      });
    },
    [manifest, client],
  );

  const createView = useCallback(
    async (name?: string): Promise<string | null> => {
      const current = manifest;
      if (!current) return null;
      const id = shortId(idPrefix);
      const existingNames = current.views.map((v) => v.name);
      const desired = name?.trim() || defaultNameRef.current(existingNames);
      const finalName = uniqueName(desired, existingNames);
      const meta: ViewMeta = { id, name: finalName, createdAt: new Date().toISOString() };
      try {
        await saveBoardData(client.boardEndpointFor(id), {
          issueMembers: {},
          noteNodes: [],
          edges: [],
          groups: [],
        });
      } catch (e) {
        console.error(`[useViewsList ${client.manifestEndpoint}] create board failed`, e);
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
    [manifest, persist, client, idPrefix],
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
      if (current.views.length <= 1) return;
      const remaining = current.views.filter((v) => v.id !== id);
      const newActive = current.activeId === id ? remaining[0]!.id : current.activeId;
      const next: ViewsManifest = { views: remaining, activeId: newActive };
      const saved = await persist(next);
      if (saved) {
        try {
          await client.deleteViewBoard(id);
        } catch (e) {
          console.warn(`[useViewsList ${client.manifestEndpoint}] board file delete failed (manifest already updated)`, e);
        }
      }
    },
    [manifest, persist, client],
  );

  const activeId = manifest?.activeId ?? null;
  const boardEndpoint = activeId ? client.boardEndpointFor(activeId) : null;

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

export type UseWorkingOnViews = UseViewsList;

export function useWorkingOnViews(onError?: (e: unknown) => void): UseViewsList {
  return useViewsList(
    dayViewsClient,
    { defaultName: () => formatDefaultViewName(), idPrefix: "wov" },
    onError,
  );
}

export function useCustomViews(onError?: (e: unknown) => void): UseViewsList {
  return useViewsList(
    customViewsClient,
    { defaultName: (existing) => nextCustomName(existing), idPrefix: "cv" },
    onError,
  );
}
