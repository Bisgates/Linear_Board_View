import type { XY } from "./layout";

const KEY = "linear_board_view:positions:v1";

export type PositionMap = Record<string, XY>;

export function loadPositions(): PositionMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as PositionMap;
    return {};
  } catch {
    return {};
  }
}

export function savePositions(map: PositionMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[persist] localStorage save failed", err);
  }
}

/**
 * Merge: keep stored positions only for ids present in `validIds`.
 * Returns the trimmed map and a count of discarded orphan ids.
 */
export function pruneOrphans(map: PositionMap, validIds: Set<string>): { kept: PositionMap; discarded: number } {
  const kept: PositionMap = {};
  let discarded = 0;
  for (const [id, pos] of Object.entries(map)) {
    if (validIds.has(id)) kept[id] = pos;
    else discarded++;
  }
  return { kept, discarded };
}
