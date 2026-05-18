import type { BoardData } from "./workingOn";
import {
  type BoardSource,
  deleteCustomViewBoard,
  deleteDayViewBoard,
  readCustomManifest,
  readCustomViewBoard,
  readDayManifest,
  readDayViewBoard,
  writeCustomManifest,
  writeCustomViewBoard,
  writeDayManifest,
  writeDayViewBoard,
} from "./tauriInvoke";

export interface ViewMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface ViewsManifest {
  views: ViewMeta[];
  activeId: string;
}

export interface ViewsClient {
  kind: "day" | "custom";
  loadManifest: () => Promise<ViewsManifest>;
  saveManifest: (m: ViewsManifest) => Promise<ViewsManifest>;
  loadBoard: (id: string) => Promise<BoardData>;
  saveBoard: (id: string, data: BoardData) => Promise<BoardData>;
  deleteBoard: (id: string) => Promise<void>;
  boardSource: (id: string) => BoardSource;
}

// --- Day (Working On) client ---

export const dayViewsClient: ViewsClient = {
  kind: "day",
  loadManifest: readDayManifest,
  saveManifest: writeDayManifest,
  loadBoard: readDayViewBoard,
  saveBoard: writeDayViewBoard,
  deleteBoard: deleteDayViewBoard,
  boardSource: (viewId) => ({ kind: "day-view", viewId }),
};

export const loadManifest = () => dayViewsClient.loadManifest();
export const saveManifest = (m: ViewsManifest) => dayViewsClient.saveManifest(m);
export const deleteViewBoard = (id: string) => dayViewsClient.deleteBoard(id);

// --- Custom client ---

export const customViewsClient: ViewsClient = {
  kind: "custom",
  loadManifest: readCustomManifest,
  saveManifest: writeCustomManifest,
  loadBoard: readCustomViewBoard,
  saveBoard: writeCustomViewBoard,
  deleteBoard: deleteCustomViewBoard,
  boardSource: (viewId) => ({ kind: "custom-view", viewId }),
};

// --- Naming ---

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / 86400000;
  return Math.floor(diff) + 1;
}

/** Returns names like `2026-05-15 20.4` — date plus `<weekOfYear>.<weekday>`.
 *  Week boundary is Sunday (Sunday=0), week 1 always contains Jan 1. */
export function formatDefaultViewName(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const jan1Dow = new Date(d.getFullYear(), 0, 1).getDay();
  const w = Math.floor((dayOfYear(d) + jan1Dow - 1) / 7) + 1;
  return `${yyyy}-${mm}-${dd} ${w}.${d.getDay()}`;
}

/** Append `(2)`, `(3)`… until the name is not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${base} (${i})`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/**
 * Pick the smallest `Custom N` not already taken. Unlike `uniqueName`, this
 * returns `Custom 1` first, not `Custom (2)` — Custom views start their own
 * counter rather than disambiguating a shared base.
 */
export function nextCustomName(taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let i = 1; i < 999; i += 1) {
    const candidate = `Custom ${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `Custom ${Date.now()}`;
}
