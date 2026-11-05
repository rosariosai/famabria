import { describe, expect, it } from 'vitest';
import { adoptMembers, sanitizeMembers } from '../src/core/events';

describe('family members shared as defaults', () => {
  const inc = [{ id: 'personal', name: 'Ros', color: 'blue' as const }, { id: 'wife', name: 'Anna', color: 'pink' as const }];
  it('a new device gets the family members', () => {
    const r = adoptMembers([{ id: 'personal', name: 'name1', color: 'blue' }], inc);
    expect(r.map((c) => c.name)).toEqual(['Ros', 'Anna']);
  });
  it('never overwrites names the person chose', () => {
    const local = [{ id: 'personal', name: 'Io', color: 'green' as const }];
    const r = adoptMembers(local, inc);
    expect(r[0].name).toBe('Io'); expect(r[0].color).toBe('green'); expect(r.length).toBe(2);
  });
  it('returns the same array when nothing changes, and cleans bad data', () => {
    const local = [{ id: 'personal', name: 'Io', color: 'green' as const }, { id: 'wife', name: 'Lei', color: 'pink' as const }];
    expect(adoptMembers(local, inc)).toBe(local);
    expect(sanitizeMembers([{ id: 'a', name: ' X ', color: 'zzz' }, { id: '', name: 'n' }, 5])).toEqual([{ id: 'a', name: 'X', color: 'gray' }]);
  });
});
