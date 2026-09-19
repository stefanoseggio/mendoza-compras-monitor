import { describe, expect, it } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';
import type { DeltaState } from '../src/state.js';

const EMPTY_STATE: DeltaState = { entries: {}, lastRunAt: null };

// Live check against the real site - skipped in CI (same lesson as every
// other actor in this portfolio: don't make CI depend on an external host
// with no uptime guarantee).
//
// Kept in its own file, separate from fetchTenders.test.ts: that file's
// `vi.mock('impit', ...)` (needed so its mocked unit tests don't leak a real
// network call - see AGENTS.md "HTTP transport: impit") is hoisted for the
// WHOLE file it's declared in, so if these live tests lived in that same
// file they would also get the mocked Impit and silently stop hitting the
// real portal at all (verified live 2026-09-19: every "live" call resolved
// to `undefined` instead of a response once the mock was added, because the
// mocked fetchMock had no implementation configured by the time these tests
// ran). A separate file has its own module registry, so this one's `Impit`
// import is the real, unmocked package.
describe.skipIf(process.env.CI)('live fetchTenders against the real Mendoza COMPR.AR portal', () => {
    it('walks multiple real pages and returns well-formed, unique tenders', async () => {
        const { tenders } = await fetchTenders({
            maxItems: 35,
            onlyNew: false,
            resolveSourceUrl: true,
            state: EMPTY_STATE,
            now: new Date(),
        });

        expect(tenders.length).toBeGreaterThan(10); // proves pagination actually advanced past page 1
        expect(tenders.length).toBeLessThanOrEqual(35);
        for (const t of tenders) {
            expect(t.numeroProceso).toBeTruthy();
            expect(t.scraped_at).toBeTruthy();
            expect(t.record_id).toBe(t.numeroProceso);
            expect(t.event_type).toBe('NEW_LISTING');
            expect(t.source_url).toContain('https://comprar.mendoza.gov.ar/');
        }

        const ids = tenders.map((t) => t.numeroProceso);
        expect(new Set(ids).size).toBe(ids.length); // no duplicate rows across pages
    }, 120_000);

    it('respects maxItems as a hard cap even though the real backlog is far larger', async () => {
        const { tenders } = await fetchTenders({
            maxItems: 5,
            onlyNew: false,
            resolveSourceUrl: true,
            state: EMPTY_STATE,
            now: new Date(),
        });
        expect(tenders.length).toBeLessThanOrEqual(5);
    }, 60_000);

    it('marks every record is_new=true on a cold run (empty state)', async () => {
        const { tenders } = await fetchTenders({
            maxItems: 5,
            onlyNew: false,
            resolveSourceUrl: true,
            state: EMPTY_STATE,
            now: new Date(),
        });
        expect(tenders.every((t) => t.is_new)).toBe(true);
    }, 60_000);
});
