export const STATS_RANGES = [7, 30, 60];
export const DEFAULT_STATS_RANGE = 30;

export function normalizeStatsRange(value) {
  const days = Number.parseInt(value, 10);
  return STATS_RANGES.includes(days) ? days : DEFAULT_STATS_RANGE;
}
