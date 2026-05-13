import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALL_ISSUES_BOARD_ENDPOINT,
  EMPTY_BOARD,
  WORKING_ON_ENDPOINT,
  loadBoardData,
  saveBoardData,
  type BoardData,
} from "./workingOn";

export interface UseBoardState {
  data: BoardData;
  loaded: boolean;
  setData: (updater: BoardData | ((prev: BoardData) => BoardData)) => void;
  undo: () => boolean;
}

const DEBOUNCE_MS = 200;
const MAX_UNDO = 50;

/**
 * Hook that loads a board's data from the given endpoint, keeps it in local
 * state, debounces writes back to the endpoint, and maintains an undo stack.
 * Used by every spatial-board view in the app (Working On, All Issues, etc.) —
 * each view supplies its own endpoint.
 */
export function useBoardState(endpoint: string, onError?: (e: unknown) => void): UseBoardState {
  const [data, setDataState] = useState<BoardData>(EMPTY_BOARD);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<BoardData>(EMPTY_BOARD);
  const undoStack = useRef<BoardData[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadBoardData(endpoint);
        if (cancelled) return;
        latestRef.current = d;
        setDataState(d);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        console.error(`[board ${endpoint}] load failed`, e);
        onErrorRef.current?.(e);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const snapshot = latestRef.current;
      saveBoardData(endpoint, snapshot).catch((e) => {
        console.error(`[board ${endpoint}] save failed`, e);
        onErrorRef.current?.(e);
      });
    }, DEBOUNCE_MS);
  }, [endpoint]);

  const setData = useCallback<UseBoardState["setData"]>(
    (updater) => {
      setDataState((prev) => {
        const next =
          typeof updater === "function" ? (updater as (p: BoardData) => BoardData)(prev) : updater;
        if (next === prev) return prev;
        undoStack.current.push(prev);
        if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
        latestRef.current = next;
        schedule();
        return next;
      });
    },
    [schedule],
  );

  const undo = useCallback<UseBoardState["undo"]>(() => {
    const prev = undoStack.current.pop();
    if (!prev) return false;
    latestRef.current = prev;
    setDataState(prev);
    schedule();
    return true;
  }, [schedule]);

  return { data, loaded, setData, undo };
}

export const useWorkingOnState = (onError?: (e: unknown) => void) =>
  useBoardState(WORKING_ON_ENDPOINT, onError);

export const useAllIssuesBoardState = (onError?: (e: unknown) => void) =>
  useBoardState(ALL_ISSUES_BOARD_ENDPOINT, onError);
