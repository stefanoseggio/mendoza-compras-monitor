import { describe, expect, it } from 'vitest';

import { isWithinDateRange, parseFechaApertura } from '../src/dateFilter.js';

describe('parseFechaApertura', () => {
    it('parses the real "DD/MM/YYYY HH:MM Hrs." format from the fixtures', () => {
        const date = parseFechaApertura('16/03/2020 10:00 Hrs.');
        expect(date?.toISOString()).toBe('2020-03-16T10:00:00.000Z');
    });

    it('parses a date-only value with no time portion', () => {
        const date = parseFechaApertura('07/02/2025');
        expect(date?.toISOString()).toBe('2025-02-07T00:00:00.000Z');
    });

    it('returns null for an unparseable value', () => {
        expect(parseFechaApertura('')).toBeNull();
        expect(parseFechaApertura('not a date')).toBeNull();
    });
});

describe('isWithinDateRange', () => {
    it('returns true (no filter) when no preset is given', () => {
        expect(isWithinDateRange(null, undefined, new Date())).toBe(true);
    });

    it('returns false when the date failed to parse', () => {
        expect(isWithinDateRange(null, '24h', new Date())).toBe(false);
    });

    it('matches a past date that falls inside the window', () => {
        const now = new Date('2026-05-19T10:00:00.000Z');
        const openedYesterday = new Date('2026-05-18T10:00:00.000Z');
        expect(isWithinDateRange(openedYesterday, '7d', now)).toBe(true);
    });

    it('excludes a past date older than the window', () => {
        const now = new Date('2026-05-19T10:00:00.000Z');
        const openedInMarch = new Date('2020-03-16T10:00:00.000Z');
        expect(isWithinDateRange(openedInMarch, '7d', now)).toBe(false);
    });

    // Mendoza's "Fecha de apertura" is a SCHEDULED bid-opening date and is
    // routinely in the future relative to "now" (a currently-open tender)
    // - unlike HSE's always-past Offence Date. A naive `now - date <=
    // window` check would treat a negative difference as always in-range,
    // silently matching every future-dated process. This must not happen.
    it('excludes a future-dated process even though it is close to now', () => {
        const now = new Date('2026-05-19T10:00:00.000Z');
        const opensNextWeek = new Date('2026-05-26T10:00:00.000Z');
        expect(isWithinDateRange(opensNextWeek, '30d', now)).toBe(false);
    });
});
