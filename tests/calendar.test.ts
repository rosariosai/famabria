import { describe, expect, it } from 'vitest';
import { daysInMonth, easter, isoWeek, italianHolidays, monthCells, moonPhases, movableFeasts, parseYearMonth, shiftMonth, weekdayOf } from '../src/core/calendar';

describe('easter', () => {
  it.each([[2024, 2, 31], [2025, 3, 20], [2026, 3, 5], [2027, 2, 28], [2028, 3, 16], [2038, 3, 25]])('%i', (y, m, d) => {
    expect(easter(y)).toEqual([m, d]);
  });
});

describe('italian holidays', () => {
  it('has 12 holidays in 2027, including the moving ones', () => {
    const h = italianHolidays(2027);
    expect(Object.keys(h)).toHaveLength(12);
    expect(h['2027-03-28']).toBe('Pasqua');
    expect(h['2027-03-29']).toBe("Lunedì dell'Angelo");
    expect(h['2027-01-06']).toBe('Epifania del Signore');
    expect(h['2027-12-26']).toBe('Santo Stefano');
  });
});

describe('dates', () => {
  it('weekday, month length, ISO week', () => {
    expect(weekdayOf(2027, 0, 1)).toBe(5); // Friday
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2027, 1)).toBe(28);
    expect(isoWeek(2027, 0, 4)).toBe(1);
    expect(isoWeek(2027, 0, 25)).toBe(4);
    expect(isoWeek(2026, 11, 28)).toBe(53);
    expect(isoWeek(2021, 0, 1)).toBe(53);
  });
  it('shifts months across years', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
    expect(shiftMonth({ year: 2027, month: 5 }, -18)).toEqual({ year: 2025, month: 11 });
  });
  it('parses year-month', () => {
    expect(parseYearMonth('2027-01')).toEqual({ year: 2027, month: 0 });
    expect(parseYearMonth('2027-13')).toBeNull();
    expect(parseYearMonth('hello')).toBeNull();
  });
});

describe('moon phases', () => {
  // Oracle: the printed wall calendar for January 2027 (new 7, first quarter 15, full 22, last quarter 29).
  it('matches the printed calendar for January 2027', () => {
    expect(moonPhases(2027, 0)).toEqual({ '2027-01-07': 'new', '2027-01-15': 'first', '2027-01-22': 'full', '2027-01-29': 'last' });
  });
  it('has about four phases a month and a full moon on 2026-10-26 (Rome)', () => {
    expect(Object.keys(moonPhases(2026, 9)).length).toBeGreaterThanOrEqual(4);
    expect(Object.entries(moonPhases(2026, 9)).find(([, p]) => p === 'full')?.[0]).toBe('2026-10-26');
  });
});

describe('monthCells (January 2027, as printed)', () => {
  const cells = monthCells(2027, 0);
  it('marks the same red days as the printed calendar', () => {
    expect(cells.filter((c) => c.red).map((c) => c.day)).toEqual([1, 3, 6, 10, 17, 24, 31]);
  });
  it('shows week numbers on Mondays 1-5', () => {
    expect(cells.filter((c) => c.week).map((c) => `${c.day}:${c.week}`)).toEqual(['4:1', '11:2', '18:3', '25:4']);
  });
  it('has 31 cells', () => expect(cells).toHaveLength(31));
});

describe('saints and captions (C2)', () => {
  it('January 2027 captions match the printed calendar word for word', () => {
    const printed = ['SS. Maria Madre di Dio, Capodanno', 'SS. Basilio e Gregorio', 'S. Genoveffa', 'S. Ermete', 'S. Amelia', 'Epifania di N.S.', 'S. Raimondo', 'S. Luciano', 'S. Alessia',
      'S. Aldo Eremita, Battesimo di Gesù', 'S. Igino', 'S. Modesto', 'S. Ilario', 'S. Felice', 'S. Mauro', 'S. Marcello', 'S. Antonio Abate', 'S. Liberata', 'S. Mario', 'SS. Sebastiano e Fabiano',
      'S. Agnese', 'SS. Gaudenzio e Vincenzo', 'S. Emerenziana', 'S. Francesco di Sales', 'S. Sabino, Convers. di S. Paolo', 'SS. Tito e Timoteo', 'S. Angela Merici', "S. Tommaso d'Aquino",
      'S. Valerio', 'S. Martina', 'S. Giovanni Bosco'];
    expect(monthCells(2027, 0).map((c) => c.caption)).toEqual(printed);
  });
  it('dataset covers every day of the year (29 Feb included)', () => {
    for (let m = 0; m < 12; m++) {
      const n = daysInMonth(2028, m);
      for (let d = 1; d <= n; d++) {
        const c = monthCells(2028, m)[d - 1];
        expect(c.caption.length, `${m + 1}/${d}`).toBeGreaterThan(0);
      }
    }
  });
  it('moveable feasts and holidays appear once, without duplicate wording', () => {
    const find = (y: number, m: number, d: number) => monthCells(y, m)[d - 1];
    expect(find(2027, 2, 28).caption).toBe('S. Castore, Pasqua');
    expect(find(2027, 1, 10).caption).toContain('Ceneri');
    expect(find(2026, 11, 25).caption).toBe('Natale del Signore');
    expect(find(2026, 10, 1).caption).toBe('Ognissanti');
    expect(find(2026, 7, 15).caption).toBe('Assunzione di Maria (Ferragosto)');
    expect(find(2026, 11, 8).caption).toBe('Immacolata Concezione');
    expect(find(2026, 11, 26).caption).toBe('Santo Stefano');
    expect(find(2026, 5, 2).caption).toBe('SS. Marcellino e Pietro, Festa della Repubblica');
  });
  it('can hide saints and add a local holiday that is red', () => {
    const c = monthCells(2026, 5, { saints: false, local: { name: 'Santi Pietro e Paolo (Roma)', month: 5, day: 29 } });
    expect(c[28].red).toBe(true);
    expect(c[28].caption).toBe('Santi Pietro e Paolo (Roma)');
    expect(c[0].caption).toBe('');
  });
  it('moveable feasts for 2027', () => {
    const f = movableFeasts(2027);
    expect(f['2027-01-10']).toBe('Battesimo di Gesù');
    expect(f['2027-02-10']).toBe('Mercoledì delle Ceneri');
    expect(f['2027-05-09']).toBe('Ascensione del Signore');
    expect(f['2027-12-26']).toBe('Sacra Famiglia');
  });
});

import { swipeMonthDelta } from '../src/core/calendar';
describe('swipeMonthDelta', () => {
  it('swipe left = next month, right = previous', () => {
    expect(swipeMonthDelta(-120, 10, 300)).toBe(1);
    expect(swipeMonthDelta(120, -10, 300)).toBe(-1);
  });
  it('ignores short, slow or mostly vertical swipes', () => {
    expect(swipeMonthDelta(-40, 0, 200)).toBe(0);
    expect(swipeMonthDelta(-120, 0, 1200)).toBe(0);
    expect(swipeMonthDelta(-100, 90, 300)).toBe(0);
    expect(swipeMonthDelta(0, 200, 300)).toBe(0);
  });
});
