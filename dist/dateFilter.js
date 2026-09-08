const WINDOW_MS = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};
// "Fecha de apertura" is rendered as "DD/MM/YYYY HH:MM Hrs." - verified
// against both real fixtures (e.g. "16/03/2020 10:00 Hrs.",
// "07/02/2025 13:00 Hrs."). DD/MM (not US MM/DD) and the trailing literal
// "Hrs." are both load-bearing; a handful of rows across the two fixtures
// carry no time portion at all in older captures, so the minutes/hours
// group is matched but not required for the date itself to resolve.
export function parseFechaApertura(value) {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!match)
        return null;
    const [, dd, mm, yyyy, hh, min] = match;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh ?? 0), Number(min ?? 0)));
}
// Unlike uk-hse-enforcement-monitor's Offence Date (always in the past - an
// offence already happened before it was prosecuted), Mendoza's "Fecha de
// apertura" is the process's SCHEDULED bid-opening date, which is routinely
// a FUTURE date relative to when the process was actually published (a
// currently-open tender's opening date is, by definition, still ahead of
// today). A naive `now - date <= window` check (the HSE formula) would give
// a NEGATIVE difference for any future-dated process, and a negative number
// is always <= a positive window - silently matching every future-dated
// tender regardless of how far out it is. Guarded explicitly here: only a
// date that has already happened (date <= now) AND falls inside the window
// counts as "within range".
export function isWithinDateRange(date, preset, now) {
    if (!preset)
        return true;
    if (!date)
        return false;
    const diffMs = now.getTime() - date.getTime();
    return diffMs >= 0 && diffMs <= WINDOW_MS[preset];
}
//# sourceMappingURL=dateFilter.js.map