import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_WORKING_ON, loadWorkingOn, saveWorkingOn, type WorkingOnData } from "./workingOn";

export interface UseWorkingOnState {
  data: WorkingOnData;
  loaded: boolean;
  setData: (updater: WorkingOnData | ((prev: WorkingOnData) => WorkingOnData)) => void;
}

const DEBOUNCE_MS = 200;

export function useWorkingOnState(onError?: (e: unknown) => void): UseWorkingOnState {
  const [data, setDataState] = useState<WorkingOnData>(EMPTY_WORKING_ON);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<WorkingOnData>(EMPTY_WORKING_ON);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadWorkingOn();
        if (cancelled) return;
        latestRef.current = d;
        setDataState(d);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        console.error("[workingOn] load failed", e);
        onErrorRef.current?.(e);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const snapshot = latestRef.current;
      saveWorkingOn(snapshot).catch((e) => {
        console.error("[workingOn] save failed", e);
        onErrorRef.current?.(e);
      });
    }, DEBOUNCE_MS);
  }, []);

  const setData = useCallback<UseWorkingOnState["setData"]>(
    (updater) => {
      setDataState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: WorkingOnData) => WorkingOnData)(prev) : updater;
        latestRef.current = next;
        schedule();
        return next;
      });
    },
    [schedule],
  );

  return { data, loaded, setData };
}
