import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "linear_board_view:pinned_tabs:v1";

interface StoredShape {
  order: string[];
}

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredShape;
    if (!parsed || !Array.isArray(parsed.order)) return [];
    return parsed.order.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function saveOrder(order: string[]): void {
  try {
    const payload: StoredShape = { order };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
 */
export function usePinnedTabs(existingIds: string[]): UsePinnedTabs {
  const [order, setOrder] = useState<string[]>(() => loadOrder());

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
  // identity check so we don't loop.
  useEffect(() => {
    if (reconciled !== order) {
      setOrder(reconciled);
      saveOrder(reconciled);
    }
  }, [reconciled, order]);

  const isPinned = useCallback((id: string) => reconciled.includes(id), [reconciled]);

  const pin = useCallback((id: string) => {
    setOrder((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveOrder(next);
      return next;
    });
  }, []);

  const unpin = useCallback((id: string) => {
    setOrder((prev) => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter((x) => x !== id);
      saveOrder(next);
      return next;
    });
  }, []);

  const reorder = useCallback((fromIdx: number, toIdx: number) => {
    setOrder((prev) => {
      if (fromIdx < 0 || fromIdx >= prev.length) return prev;
      if (toIdx < 0 || toIdx > prev.length) return prev;
      if (fromIdx === toIdx) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(fromIdx, 1);
      const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
      arr.splice(insertAt, 0, moved!);
      saveOrder(arr);
      return arr;
    });
  }, []);

  return { order: reconciled, isPinned, pin, unpin, reorder };
}
