import { log } from 'apify';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

import { type DateRangePreset, isWithinDateRange, parseFechaApertura } from './dateFilter.js';
import { buildPostbackPayload } from './parsers/form.js';
import { parseGrid } from './parsers/grid.js';
import type { ParsedTenderRow, TenderRow } from './types.js';

const HOME_URL = 'https://comprar.mendoza.gov.ar/';
const SEARCH_URL = 'https://comprar.mendoza.gov.ar/BuscarAvanzado2.aspx';

const HOME_SEARCH_BUTTON = 'ctl00$CPH1$CtrlBusquedasHome$btnBusquedaProcesos';
const LISTAR_BUTTON = 'ctl00$CPH1$btnListarPliegoAvanzado';
const GRID_TARGET = 'ctl00$CPH1$GridListaPliegos';

const PAGE_SIZE = 10;
// 25784 total processes at audit time / 10 per page - a full crawl is a
// legitimate but very large ask; this cap is a safety backstop against a
// runaway loop, not the expected steady-state stop (that's maxItems, 0
// rows, or a stalled page).
const MAX_PAGES_SAFETY_CAP = 5000;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function extractCookieHeader(response: Response, existing: string | null): string | null {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length === 0) return existing;
    const jar = new Map<string, string>();
    if (existing) {
        for (const pair of existing.split('; ')) {
            const eq = pair.indexOf('=');
            if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
    }
    for (const raw of setCookies) {
        const pair = raw.split(';')[0];
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

interface FetchOptions {
    url: string;
    method?: 'GET' | 'POST';
    body?: string;
    cookie: string | null;
}

async function requestWithRetry(options: FetchOptions, maxRetries = 4, baseDelayMs = 1000): Promise<Response> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const headers: Record<string, string> = {};
            if (options.cookie) headers.Cookie = options.cookie;
            if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
            const response = await fetch(options.url, {
                method: options.method ?? 'GET',
                headers,
                body: options.body,
                redirect: 'follow',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * 2 ** attempt);
            }
        }
    }
    throw lastError;
}

// Replays a single row's own postback link to resolve its real permalink.
// Verified live 2026-09-06: clicking a row's "numeroProceso" link
// redirects to PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=<token> - a
// standalone, cookie-independent URL that resolves correctly even with no
// prior session at all (confirmed with a bare fetch, zero cookies). The
// same page's ViewState can be reused for every row on it, in any order,
// without disturbing that page's own further pagination - also verified
// live (4 sequential row-detail postbacks from one page's ViewState,
// followed by the normal Page$2 postback from that same unmodified
// ViewState, both succeeded). This intentionally does NOT feed the detail
// response's Set-Cookie back into the caller's cookie jar - it's a
// side-channel read, isolated from the main pagination session state.
async function resolveSourceUrl($: CheerioAPI, cookie: string | null, linkTarget: string): Promise<string | null> {
    try {
        const payload = buildPostbackPayload($, linkTarget, '');
        const response = await requestWithRetry({
            url: SEARCH_URL,
            method: 'POST',
            body: new URLSearchParams(payload).toString(),
            cookie,
        });
        return response.url || null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warning(`No se pudo resolver la URL directa del proceso tras reintentos: ${message}`);
        return null;
    }
}

export interface FetchTendersOptions {
    maxItems: number;
    onlyNew: boolean;
    dateRange?: DateRangePreset;
    seenIds: ReadonlySet<string>;
    now: Date;
}

export interface FetchTendersResult {
    tenders: TenderRow[];
    // Every raw numeroProceso walked this run (up to maxItems), regardless
    // of whether onlyNew/dateRange kept it in `tenders` - this is what gets
    // persisted as "seen" for next run, matching the same precedent as
    // uk-hse-enforcement-monitor (a dateRange-excluded record was still
    // genuinely observed, so it shouldn't look "new" again next time).
    allIdsThisRun: string[];
}

// Verified live 2026-09-04: comprar.mendoza.gov.ar (COMPR.AR) is reachable
// without a proxy, and although the site DOES have real DevExpress
// controls (ASPxDateEdit, ASPxCallback, UpdatePanel, ScriptManager) - the
// same family that killed an earlier national-COMPR.AR candidate - those
// are confined to peripheral filter widgets (date picker, supplier-search
// modal). The results grid itself, id="ctl00_CPH1_GridListaPliegos", is a
// classic ASP.NET GridView (plain <thead>/<tbody>, not ASPxGridView), and
// its paging is the standard, well-documented __EVENTARGUMENT="Page$N"
// mechanism - confirmed live to accept ANY page number directly
// (jumped straight from page 1 to page 50 with no intermediate requests
// and got correct, different data), unlike cordoba-compras-monitor's
// bespoke sliding-window pager which required walking through empty
// "next block" slots. This makes the fetch loop here simpler: just
// increment the page number, no pager-window bookkeeping needed.
//
// Delta engine (2026-09-06 retrofit): `maxItems` still caps the RAW number
// of processes walked, exactly as before - onlyNew/dateRange are applied
// as POST-filters on top (see AGENTS.md for why this is a safe post-filter
// rather than early-stop pagination: this listing is sorted by numero de
// proceso ascending, NOT newest-first, verified live).
export async function fetchTenders(options: FetchTendersOptions): Promise<FetchTendersResult> {
    const { maxItems, onlyNew, dateRange, seenIds, now } = options;
    const scrapedAt = now.toISOString();

    const rawIds = new Set<string>(); // dedup + raw maxItems cap, same role the old `seenIds` Set played
    const tenders: TenderRow[] = [];

    async function processRows(rows: ParsedTenderRow[], $: CheerioAPI, cookie: string | null): Promise<number> {
        let added = 0;
        for (const row of rows) {
            if (rawIds.size >= maxItems) break;
            if (rawIds.has(row.numeroProceso)) continue;
            rawIds.add(row.numeroProceso);
            added += 1;

            const isNew = !seenIds.has(row.numeroProceso);
            if (onlyNew && !isNew) continue;
            if (dateRange && !isWithinDateRange(parseFechaApertura(row.fechaApertura), dateRange, now)) continue;

            const sourceUrl = row.linkTarget ? await resolveSourceUrl($, cookie, row.linkTarget) : null;

            tenders.push({
                numeroProceso: row.numeroProceso,
                nombreProceso: row.nombreProceso,
                tipoProceso: row.tipoProceso,
                fechaApertura: row.fechaApertura,
                estado: row.estado,
                unidadEjecutora: row.unidadEjecutora,
                servicioAdministrativoFinanciero: row.servicioAdministrativoFinanciero,
                monto: row.monto,
                record_id: row.numeroProceso,
                event_type: 'NEW_LISTING',
                scraped_at: scrapedAt,
                is_new: isNew,
                // Degraded fallback if the per-row permalink couldn't be
                // resolved (missing link markup, or the extra postback
                // failed after retries) - still a real, useful URL (the
                // search page itself), just not process-specific. Disclosed
                // in AGENTS.md/README, not silently swallowed.
                source_url: sourceUrl ?? SEARCH_URL,
            });
        }
        return added;
    }

    let cookie: string | null = null;

    const homeResponse = await requestWithRetry({ url: HOME_URL, cookie });
    cookie = extractCookieHeader(homeResponse, cookie);
    let html = await homeResponse.text();
    let $: CheerioAPI = cheerio.load(html);

    const homePayload = buildPostbackPayload($, HOME_SEARCH_BUTTON);
    const searchLandingResponse = await requestWithRetry({
        url: HOME_URL,
        method: 'POST',
        body: new URLSearchParams(homePayload).toString(),
        cookie,
    });
    cookie = extractCookieHeader(searchLandingResponse, cookie);
    html = await searchLandingResponse.text();
    $ = cheerio.load(html);

    const listarPayload = buildPostbackPayload($, LISTAR_BUTTON);
    const page1Response = await requestWithRetry({
        url: SEARCH_URL,
        method: 'POST',
        body: new URLSearchParams(listarPayload).toString(),
        cookie,
    });
    cookie = extractCookieHeader(page1Response, cookie);
    html = await page1Response.text();
    $ = cheerio.load(html);

    const page1Rows = parseGrid($);
    await processRows(page1Rows, $, cookie);
    log.info(`Pagina 1: ${page1Rows.length} procesos`);

    let previousFirstId = page1Rows[0]?.numeroProceso ?? null;

    for (let pageNum = 2; pageNum <= MAX_PAGES_SAFETY_CAP && rawIds.size < maxItems; pageNum++) {
        const pagePayload = buildPostbackPayload($, GRID_TARGET, `Page$${pageNum}`);
        let response: Response;
        try {
            response = await requestWithRetry({
                url: SEARCH_URL,
                method: 'POST',
                body: new URLSearchParams(pagePayload).toString(),
                cookie,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.warning(`Fallo al pedir la pagina ${pageNum} tras reintentos: ${message}. Devolviendo lo acumulado.`);
            break;
        }

        cookie = extractCookieHeader(response, cookie);
        html = await response.text();
        $ = cheerio.load(html);

        const rows = parseGrid($);
        if (rows.length === 0) {
            log.info(`Pagina ${pageNum}: 0 filas - fin de resultados.`);
            break;
        }

        const firstId = rows[0].numeroProceso;
        if (firstId === previousFirstId) {
            log.warning(`La pagina ${pageNum} repitio el primer registro de la pagina anterior - fin de resultados.`);
            break;
        }
        previousFirstId = firstId;

        await processRows(rows, $, cookie);
        if (pageNum % 20 === 0 || rows.length < PAGE_SIZE) {
            log.info(
                `Pagina ${pageNum}: ${rows.length} procesos (acumulado crudo: ${rawIds.size}, en salida: ${tenders.length})`,
            );
        }
    }

    return { tenders, allIdsThisRun: Array.from(rawIds) };
}
