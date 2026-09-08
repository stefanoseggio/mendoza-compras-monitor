import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTenders } from '../src/fetchTenders.js';
import { fingerprintOf } from '../src/fingerprint.js';
import { parseGrid } from '../src/parsers/grid.js';
import type { DeltaState, SeenEntry } from '../src/state.js';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
const PAGE1 = readFileSync(`${fixturesDir}/page1.html`, 'utf-8');
const PAGE2 = readFileSync(`${fixturesDir}/page2.html`, 'utf-8');
const NO_RESULTS = readFileSync(`${fixturesDir}/page_no_results.html`, 'utf-8');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const EMPTY_STATE: DeltaState = { entries: {}, lastRunAt: null };

// A row-detail postback (see resolveSourceUrlPostback in src/fetchTenders.ts)
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

// Real page-1 rows, parsed once, for building realistic previous-state entries in tests below.
const page1Rows = parseGrid(cheerio.load(PAGE1));

function stateWith(overrides: Record<string, SeenEntry>): DeltaState {
    return { entries: overrides, lastRunAt: null };
}

describe('fetchTenders delta engine (mocked HTTP, against real captured fixtures)', () => {
    beforeEach(() => {
        mockFetchSequence();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('cold run (empty state): marks every returned record NEW_LISTING/is_new=true and resolves each its own source_url', async () => {
        const { tenders, observedThisRun } = await fetchTenders({
            maxItems: 3,
            onlyNew: false,
            resolveSourceUrl: true,
            state: EMPTY_STATE,
            now: NOW,
        });

        expect(tenders).toHaveLength(3);
        expect(observedThisRun.map((o) => o.id)).toEqual(['10201-0001-CDI20', '10201-0001-CDI21', '10201-0001-CDI22']);
        for (const tender of tenders) {
            expect(tender.is_new).toBe(true);
            expect(tender.event_type).toBe('NEW_LISTING');
            expect(tender.record_id).toBe(tender.numeroProceso);
            expect(tender.scraped_at).toBe(NOW.toISOString());
            expect(tender.source_url).toContain('lnkNumeroProceso');
            expect(tender.sourceUrlResolved).toBe(true);
        }
        // each row's source_url is genuinely tied to ITS OWN postback link,
        // not a shared/static value
        expect(tenders[0].source_url).toContain('ctl02');
        expect(tenders[1].source_url).toContain('ctl03');
        expect(tenders[2].source_url).toContain('ctl04');
    });

    it('resolveSourceUrl=false skips the per-row postback entirely and falls back to the search page', async () => {
        const fetchMock = mockFetchSequence();
        const { tenders } = await fetchTenders({
            maxItems: 3,
            onlyNew: false,
            resolveSourceUrl: false,
            state: EMPTY_STATE,
            now: NOW,
        });

        expect(tenders).toHaveLength(3);
        for (const t of tenders) {
            expect(t.sourceUrlResolved).toBe(false);
            expect(t.source_url).toBe('https://comprar.mendoza.gov.ar/BuscarAvanzado2.aspx');
        }
        const detailCalls = fetchMock.mock.calls.filter(([, init]) => {
            const body = typeof (init as RequestInit | undefined)?.body === 'string' ? ((init as RequestInit).body as string) : '';
            return new URLSearchParams(body).get('__EVENTTARGET')?.endsWith('lnkNumeroProceso');
        });
        expect(detailCalls).toHaveLength(0);
    });

    it('classifies a known id with a different estado as STATUS_CHANGE', async () => {
        const target = page1Rows[0]; // 10201-0001-CDI20
        const state = stateWith({ [target.numeroProceso]: { estado: 'Pendiente Análisis (a stale value)', hash: 'irrelevant' } });

        const { tenders } = await fetchTenders({ maxItems: 1, onlyNew: true, resolveSourceUrl: true, state, now: NOW });

        expect(tenders).toHaveLength(1);
        expect(tenders[0].event_type).toBe('STATUS_CHANGE');
        expect(tenders[0].is_new).toBe(false);
    });

    it('classifies a known id, same estado, different fingerprint as UPDATED', async () => {
        const target = page1Rows[0];
        const state = stateWith({ [target.numeroProceso]: { estado: target.estado, hash: 'a-hash-that-will-never-match' } });

        const { tenders } = await fetchTenders({ maxItems: 1, onlyNew: true, resolveSourceUrl: true, state, now: NOW });

        expect(tenders).toHaveLength(1);
        expect(tenders[0].event_type).toBe('UPDATED');
    });

    it('classifies a known id, same estado, same fingerprint as UNCHANGED - delivered only when onlyNew=false', async () => {
        const target = page1Rows[0];
        const state = stateWith({ [target.numeroProceso]: { estado: target.estado, hash: fingerprintOf(target) } });

        const full = await fetchTenders({ maxItems: 1, onlyNew: false, resolveSourceUrl: true, state, now: NOW });
        expect(full.tenders).toHaveLength(1);
        expect(full.tenders[0].event_type).toBe('UNCHANGED');

        const delta = await fetchTenders({ maxItems: 1, onlyNew: true, resolveSourceUrl: true, state, now: NOW });
        expect(delta.tenders).toHaveLength(0);
    });

    it('eventTypes restricts delivery to the requested subset', async () => {
        const target = page1Rows[0];
        const state = stateWith({ [target.numeroProceso]: { estado: 'a stale estado', hash: 'x' } }); // -> STATUS_CHANGE

        const { tenders } = await fetchTenders({
            maxItems: 2, // target + the next unseen row (-> NEW_LISTING)
            onlyNew: false,
            eventTypes: ['STATUS_CHANGE'],
            resolveSourceUrl: true,
            state,
            now: NOW,
        });

        expect(tenders).toHaveLength(1);
        expect(tenders[0].numeroProceso).toBe(target.numeroProceso);
        expect(tenders[0].event_type).toBe('STATUS_CHANGE');
    });

    it('onlyNew with a fully-seen, unchanged state returns zero records, WITHOUT stopping pagination early (safe post-filter, not early-stop)', async () => {
        const fetchMock = mockFetchSequence();
        // Seed the state with every id from BOTH page 1 and page 2, unchanged -
        // an early-stop implementation would give up after the first
        // "fully known" page; a safe post-filter must keep walking to
        // maxItems regardless, since this source is not newest-first.
        const page2Rows = parseGrid(cheerio.load(PAGE2));
        const entries: Record<string, SeenEntry> = {};
        for (const row of [...page1Rows, ...page2Rows]) entries[row.numeroProceso] = { estado: row.estado, hash: fingerprintOf(row) };

        const { tenders, observedThisRun } = await fetchTenders({
            maxItems: 15,
            onlyNew: true,
            resolveSourceUrl: true,
            state: { entries, lastRunAt: null },
            now: NOW,
        });

        expect(tenders).toEqual([]);
        // proves it walked page 1 (10) AND on into page 2 (5 more) instead
        // of stopping after page 1 came back fully known
        expect(observedThisRun).toHaveLength(15);
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
            resolveSourceUrl: true,
            state: EMPTY_STATE,
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
