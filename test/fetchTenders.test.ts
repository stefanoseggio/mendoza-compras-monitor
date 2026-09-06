import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const PAGE1 = readFileSync(`${fixturesDir}/page1.html`, 'utf-8');
const PAGE2 = readFileSync(`${fixturesDir}/page2.html`, 'utf-8');
const NO_RESULTS = readFileSync(`${fixturesDir}/page_no_results.html`, 'utf-8');

const NOW = new Date('2026-09-06T12:00:00.000Z');

// A row-detail postback (see resolveSourceUrl in src/fetchTenders.ts)
// doesn't return real page HTML in production either - only its final
// `response.url` is read. This fake mirrors that shape 1:1 while making
// the resolved URL deterministic per row, so tests can assert the correct
// row's link was actually the one replayed.
function fakeResponse(body: string, url?: string): Response {
    return {
        ok: true,
        status: 200,
        url: url ?? '',
        headers: { getSetCookie: () => [] } as unknown as Headers,
        text: async () => body,
    } as unknown as Response;
}

function mockFetchSequence(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        const bodyStr = typeof init?.body === 'string' ? init.body : '';
        const params = new URLSearchParams(bodyStr);
        const target = params.get('__EVENTTARGET') ?? '';
        const argument = params.get('__EVENTARGUMENT') ?? '';

        if (target.endsWith('lnkNumeroProceso')) {
            // Row-detail postback: resolve to a deterministic fake permalink
            // that encodes which row link was replayed.
            return fakeResponse(
                '',
                `https://comprar.mendoza.gov.ar/PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=mock-${target}`,
            );
        }
        if (argument === 'Page$2') return fakeResponse(PAGE2);
        if (argument.startsWith('Page$')) return fakeResponse(NO_RESULTS);
        // GET home, POST home search, POST listar (page 1) - all just need
        // valid __VIEWSTATE-bearing markup to extract form fields from.
        return fakeResponse(PAGE1);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('fetchTenders delta engine (mocked HTTP, against real captured fixtures)', () => {
    beforeEach(() => {
        mockFetchSequence();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('cold run (empty seen-set): marks every returned record is_new=true and resolves each its own source_url', async () => {
        const { tenders, allIdsThisRun } = await fetchTenders({
            maxItems: 3,
            onlyNew: false,
            seenIds: new Set(),
            now: NOW,
        });

        expect(tenders).toHaveLength(3);
        expect(allIdsThisRun).toEqual(['10201-0001-CDI20', '10201-0001-CDI21', '10201-0001-CDI22']);
        for (const tender of tenders) {
            expect(tender.is_new).toBe(true);
            expect(tender.event_type).toBe('NEW_LISTING');
            expect(tender.record_id).toBe(tender.numeroProceso);
            expect(tender.scraped_at).toBe(NOW.toISOString());
            expect(tender.source_url).toContain('lnkNumeroProceso');
        }
        // each row's source_url is genuinely tied to ITS OWN postback link,
        // not a shared/static value
        expect(tenders[0].source_url).toContain('ctl02');
        expect(tenders[1].source_url).toContain('ctl03');
        expect(tenders[2].source_url).toContain('ctl04');
    });

    it('onlyNew with a fully-seen state returns zero records, WITHOUT stopping pagination early (safe post-filter, not early-stop)', async () => {
        const fetchMock = mockFetchSequence();
        // Seed the seen-set with every id from BOTH page 1 and page 2 -
        // an early-stop implementation would give up after the first
        // "fully known" page; a safe post-filter must keep walking to
        // maxItems regardless, since this source is not newest-first.
        const page1Ids = [
            '10201-0001-CDI20',
            '10201-0001-CDI21',
            '10201-0001-CDI22',
            '10201-0001-CDI23',
            '10201-0001-CDI24',
            '10201-0001-CDI25',
            '10201-0001-CDI26',
            '10201-0001-LPU19',
            '10201-0001-LPU20',
            '10201-0001-LPU21',
        ];
        const page2Ids = [
            '10201-0001-LPU22',
            '10201-0001-LPU23',
            '10201-0001-LPU24',
            '10201-0001-LPU25',
            '10201-0001-LPU26',
        ];
        const seenIds = new Set([...page1Ids, ...page2Ids]);

        const { tenders, allIdsThisRun } = await fetchTenders({
            maxItems: 15,
            onlyNew: true,
            seenIds,
            now: NOW,
        });

        expect(tenders).toEqual([]);
        // proves it walked page 1 (10) AND on into page 2 (5 more) instead
        // of stopping after page 1 came back fully known
        expect(allIdsThisRun).toHaveLength(15);
        // and proves it never spent a request resolving source_url for a
        // record that was going to be filtered out anyway
        const detailCalls = fetchMock.mock.calls.filter(([, init]) => {
            const body =
                typeof (init as RequestInit | undefined)?.body === 'string'
                    ? ((init as RequestInit).body as string)
                    : '';
            return new URLSearchParams(body).get('__EVENTTARGET')?.endsWith('lnkNumeroProceso');
        });
        expect(detailCalls).toHaveLength(0);
    });

    it('dateRange filtering excludes processes whose Fecha de apertura falls outside the window', async () => {
        // Page 1's rows span 2019-2026; picking `now` just after the one
        // 2026 row's opening date isolates exactly one match.
        const now = new Date('2026-05-19T10:00:00.000Z');

        const { tenders } = await fetchTenders({
            maxItems: 10,
            onlyNew: false,
            dateRange: '7d',
            seenIds: new Set(),
            now,
        });

        expect(tenders).toHaveLength(1);
        expect(tenders[0].record_id).toBe('10201-0001-CDI26');
        expect(tenders[0].fechaApertura).toBe('18/05/2026 10:00 Hrs.');
    });
});

// Live check against the real site - skipped in CI (same lesson as every
// other actor in this portfolio: don't make CI depend on an external host
// with no uptime guarantee).
describe.skipIf(process.env.CI)('live fetchTenders against the real Mendoza COMPR.AR portal', () => {
    it('walks multiple real pages and returns well-formed, unique tenders', async () => {
        const { tenders } = await fetchTenders({ maxItems: 35, onlyNew: false, seenIds: new Set(), now: new Date() });

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
        const { tenders } = await fetchTenders({ maxItems: 5, onlyNew: false, seenIds: new Set(), now: new Date() });
        expect(tenders.length).toBeLessThanOrEqual(5);
    }, 60_000);

    it('marks every record is_new=true on a cold run (empty seen-set)', async () => {
        const { tenders } = await fetchTenders({ maxItems: 5, onlyNew: false, seenIds: new Set(), now: new Date() });
        expect(tenders.every((t) => t.is_new)).toBe(true);
    }, 60_000);
});
