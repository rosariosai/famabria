import { describe, it, expect, vi, afterEach } from 'vitest';
import { newId } from '../src/core/id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('makes UUIDs', () => expect(newId()).toMatch(UUID));
  it('still works on insecure http pages (no randomUUID)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const a = newId(), b = newId();
    expect(a).toMatch(UUID); expect(a).not.toBe(b);
  });
});
