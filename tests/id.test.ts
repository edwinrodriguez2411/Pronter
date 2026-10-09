import { expect, it, vi } from 'vitest';
import { createId } from '../src/lib/id';

it('generates unique UUIDs when HTTP does not expose crypto.randomUUID', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  try {
    const ids = Array.from({ length: 100 }, createId);
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { vi.unstubAllGlobals(); }
});
