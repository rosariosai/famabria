import { describe, expect, it } from 'vitest';
import { addKeyDays, weekMonday } from '../src/core/calendar';

describe('week helpers', () => {
  it('finds the Monday of a week (weeks start on Monday)', () => {
    expect(weekMonday('2026-11-05')).toBe('2026-11-02'); // Thursday
    expect(weekMonday('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week that started the Monday before
    expect(weekMonday('2026-11-02')).toBe('2026-11-02');
  });
  it('adds days across months and years', () => {
    expect(addKeyDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addKeyDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addKeyDays('2026-10-25', 7)).toBe('2026-11-01');
  });
});
