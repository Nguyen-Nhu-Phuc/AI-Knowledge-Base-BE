import { reciprocalRankFusion } from './rrf.util';

describe('reciprocalRankFusion', () => {
  it('merges ranked lists', () => {
    const a = [
      { id: '1', item: { n: 1 } },
      { id: '2', item: { n: 2 } },
    ];
    const b = [
      { id: '2', item: { n: 2 } },
      { id: '3', item: { n: 3 } },
    ];
    const merged = reciprocalRankFusion([a, b], 60);
    expect(merged[0].id).toBe('2');
    expect(merged.map((m) => m.id).sort()).toEqual(['1', '2', '3']);
  });
});
