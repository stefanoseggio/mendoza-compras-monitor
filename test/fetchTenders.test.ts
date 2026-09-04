import { describe, expect, it } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';

// Live check against the real site - skipped in CI (same lesson as every
// other actor in this portfolio: don't make CI depend on an external host
// with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchTenders against the real Mendoza COMPR.AR portal', () => {
    it('walks multiple real pages and returns well-formed, unique tenders', async () => {
        const tenders = await fetchTenders(35);

        expect(tenders.length).toBeGreaterThan(10); // proves pagination actually advanced past page 1
        expect(tenders.length).toBeLessThanOrEqual(35);
        for (const t of tenders) {
            expect(t.numeroProceso).toBeTruthy();
            expect(t.scrapedAt).toBeTruthy();
        }

        const ids = tenders.map((t) => t.numeroProceso);
        expect(new Set(ids).size).toBe(ids.length); // no duplicate rows across pages
    }, 60_000);

    it('respects maxItems as a hard cap even though the real backlog is far larger', async () => {
        const tenders = await fetchTenders(5);
        expect(tenders.length).toBeLessThanOrEqual(5);
    }, 30_000);
});
