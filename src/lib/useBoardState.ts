import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_BOARD, type BoardData } from "./workingOn";
import { pruneGraphFlags } from "./graphMode";
import {
  type BoardSource,
  boardSourceKey,
  loadBoardFor,
  saveBoardFor,
} from "./tauriInvoke";

export interface UseBoardState {
  data: BoardData;
  loaded: boolean;
  setData: (updater: BoardData | ((prev: BoardData) => BoardData)) => void;
  undo: () => boolean;
  redo: () => boolean;
}

const DEBOUNCE_MS = 200;
const MAX_UNDO = 50;

/**
 * Hook that loads a board's data from the given source, keeps it in local
 * state, debounces writes back, and maintains an undo stack. Every
 * spatial-board view in the app (day views, custom views, all-issues) calls
 * this with its own `BoardSource` discriminator.
 */
export function useBoardState(
  source: BoardSource | null,
  onError?: (e: unknown) => void,
): UseBoardState {
  const [data, setDataState] = useState<BoardData>(EMPTY_BOARD);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<BoardData>(EMPTY_BOARD);
  const undoStack = useRef<BoardData[]>([]);
  // redoStack tracks states the user has undone past — any fresh user action
  // (via setData) wipes it, matching standard editor semantics.
  const redoStack = useRef<BoardData[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const sourceKey = boardSourceKey(source);

  useEffect(() => {
    const current = sourceRef.current;
    // Source not ready yet (e.g. manifest still loading). Reset to empty so a
    // stale view's data doesn't leak across source changes.
    if (!current) {
      latestRef.current = EMPTY_BOARD;
      undoStack.current = [];
      redoStack.current = [];
      setDataState(EMPTY_BOARD);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        // Orphan sweep on load: drop graphFlags entries whose node no longer
        // exists (same convention as stored positions). No-op (same object)
        // when nothing is stale.
        const d = pruneGraphFlags(await loadBoardFor(current));
        if (cancelled) return;
        latestRef.current = d;
        undoStack.current = [];
        redoStack.current = [];
        setDataState(d);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        console.error(`[board ${sourceKey}] load failed`, e);
        onErrorRef.current?.(e);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  const schedule = useCallback(() => {
    const current = sourceRef.current;
    if (!current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const snapshot = latestRef.current;
      saveBoardFor(current, snapshot).catch((e) => {
        console.error(`[board ${boardSourceKey(current)}] save failed`, e);
        onErrorRef.current?.(e);
      });
    }, DEBOUNCE_MS);
  }, [sourceKey]);

  const setData = useCallback<UseBoardState["setData"]>(
    (updater) => {
      // IMPORTANT: side effects (undo/redo stacks, save scheduler) must live
      // OUTSIDE the setDataState updater. React 18 StrictMode double-invokes
      // setState updaters in dev to catch impure ones — if we pushed to
      // undoStack inside the updater, every user action would land twice and
      // each U press would only undo half a step (alternating with a visual
      // no-op). Instead we use latestRef as the source of truth for "current
      // state", and call setDataState with a direct value (which is not
      // double-invoked).
      const prev = latestRef.current;
      const next =
        typeof updater === "function" ? (updater as (p: BoardData) => BoardData)(prev) : updater;
      if (next === prev) return;
      undoStack.current.push(prev);
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      // Fresh action invalidates the redo history — once you diverge from
      // the undone timeline, the previously-redoable states are gone.
      redoStack.current = [];
      latestRef.current = next;
      schedule();
      setDataState(next);
    },
    [schedule],
  );

  const undo = useCallback<UseBoardState["undo"]>(() => {
    const prev = undoStack.current.pop();
    if (!prev) return false;
    redoStack.current.push(latestRef.current);
    if (redoStack.current.length > MAX_UNDO) redoStack.current.shift();
    latestRef.current = prev;
    setDataState(prev);
    schedule();
    return true;
  }, [schedule]);

  const redo = useCallback<UseBoardState["redo"]>(() => {
    const next = redoStack.current.pop();
    if (!next) return false;
    undoStack.current.push(latestRef.current);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    latestRef.current = next;
    setDataState(next);
    schedule();
    return true;
  }, [schedule]);

  return { data, loaded, setData, undo, redo };
}

const ALL_ISSUES_SOURCE: BoardSource = { kind: "all-issues" };

export const useAllIssuesBoardState = (onError?: (e: unknown) => void) => {
  const source = useMemo(() => ALL_ISSUES_SOURCE, []);
  return useBoardState(source, onError);
};
