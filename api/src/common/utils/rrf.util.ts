export type RankedItem<T> = { id: string; item: T; rank: number };

/**
 * Reciprocal Rank Fusion.
 * score = sum 1 / (k + rank) across result lists (rank starts at 1).
 */
export function reciprocalRankFusion<T>(
  lists: Array<Array<{ id: string; item: T }>>,
  k = 60,
): Array<{ id: string; item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    list.forEach((entry, index) => {
      const rank = index + 1;
      const add = 1 / (k + rank);
      const existing = scores.get(entry.id);
      if (existing) {
        existing.score += add;
      } else {
        scores.set(entry.id, { item: entry.item, score: add });
      }
    });
  }

  return [...scores.entries()]
    .map(([id, value]) => ({ id, item: value.item, score: value.score }))
    .sort((a, b) => b.score - a.score);
}
