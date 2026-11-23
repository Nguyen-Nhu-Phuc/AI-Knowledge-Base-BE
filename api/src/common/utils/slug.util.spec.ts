import { slugify } from './slug.util';

describe('slugify', () => {
  it('normalizes basic names', () => {
    expect(slugify('Acme VN')).toBe('acme-vn');
  });

  it('strips invalid characters', () => {
    expect(slugify('Hello!!! World')).toBe('hello-world');
  });
});
