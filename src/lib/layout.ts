import type { IssueRecord } from "../linear/types";

export interface XY {
  x: number;
  y: number;
}

const COLS = 6;
const COL_W = 300;
const ROW_H = 160;
const JITTER = 12;

function seededJitter(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const norm = ((h % 1000) + 1000) % 1000;
  return (norm / 1000 - 0.5) * 2 * JITTER;
}

export function computeInitialLayout(issues: IssueRecord[]): Record<string, XY> {
  const out: Record<string, XY> = {};
  issues.forEach((iss, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    out[iss.id] = {
      x: col * COL_W + seededJitter(iss.id + ":x"),
      y: row * ROW_H + seededJitter(iss.id + ":y"),
    };
  });
  return out;
}
