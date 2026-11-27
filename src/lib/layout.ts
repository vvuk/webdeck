import type { DeviceSummary } from "../../shared/types.ts";

export interface Layout {
  rows: number;
  columns: number;
  /** False when we're guessing (no bridge data for this deck yet). */
  known: boolean;
}

/**
 * Key grid size for a deck. Profiles only store a flat list of keys (rows × columns, then any touch points), so the
 * real shape comes from the bridge plugin. Without it, use the user's column override or a reasonable guess.
 */
export function resolveLayout(device: DeviceSummary | null, keyCount: number, columnsOverride?: number): Layout {
  if (device?.rows && device.columns) return { rows: device.rows, columns: device.columns, known: true };
  const columns = columnsOverride ?? guessColumns(keyCount);
  return { rows: Math.max(1, Math.ceil(keyCount / columns)), columns, known: false };
}

/** Prefer a column count that divides the keys evenly and gives a landscape grid near 5:3 (Stream Deck MK.2). */
function guessColumns(keyCount: number): number {
  if (keyCount <= 0) return 5;
  let best = Math.min(5, keyCount);
  let bestScore = Infinity;
  for (let c = 2; c <= Math.min(10, keyCount); c++) {
    const rows = Math.ceil(keyCount / c);
    const waste = rows * c - keyCount;
    const score = Math.abs(c / rows - 5 / 3) + waste * 0.5 + (rows > c ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
