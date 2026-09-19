import { log } from 'apify';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import { Impit, type ImpitResponse } from 'impit';

import { type DateRangePreset, isWithinDateRange, parseFechaApertura } from './dateFilter.js';
import { fingerprintOf } from './fingerprint.js';
import { buildPostbackPayload } from './parsers/form.js';
import { parseGrid } from './parsers/grid.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { EventType, ParsedTenderRow, TenderRow } from './types.js';

const HOME_URL = 'https://comprar.mendoza.gov.ar/';
const SEARCH_URL = 'https://comprar.mendoza.gov.ar/BuscarAvanzado2.aspx';

// One Impit instance per actor run: it holds the connection pool and TLS
// session cache, and gives every request a real, internally-consistent
// Chrome TLS/HTTP2 fingerprint instead of Node's native (and distinctively
// bot-shaped) one - see AGENTS.md for why this was added.
const impit = new Impit({ browser: 'chrome' });

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

function extractCookieHeader(response: { headers: Headers }, existing: string | null): string | null {
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

class HttpError extends Error {
    constructor(public readonly status: number) {
        super(`HTTP ${status}`);
        this.name = 'HttpError';
    }
}

function isRetriableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

// Per-attempt timeout of 30s, well under the actor's 600s defaultRunOptions.timeoutSecs:
// worst case for one call is maxRetries+1 attempts x 30s (150s) plus capped exponential
// backoff between them (1+2+4+8s = 15s), ~165s total - a comfortable ~2.7x margin under
// the 600s ceiling, versus the previous unbounded (no AbortSignal) request that could
// hang indefinitely and consume the whole run timeout on a single stuck socket. Retries
// are now also restricted to retryable outcomes (408/425/429/5xx/network errors) instead
// of retrying every non-2xx status, matching santafe-compras-monitor's src/http.ts pattern.
async function requestWithRetry(
    options: FetchOptions,
    maxRetries = 4,
    baseDelayMs = 1000,
    timeoutMs = 30_000,
): Promise<ImpitResponse> {
    let lastError: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const headers: Record<string, string> = {};
            if (options.cookie) headers.Cookie = options.cookie;
            if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
            const response = await impit.fetch(options.url, {
                method: options.method ?? 'GET',
                headers,
                body: options.body,
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok) return response;
            if (!isRetriableStatus(response.status)) throw new HttpError(response.status);
            lastError = new HttpError(response.status);
        } catch (error) {
            if (error instanceof HttpError && !isRetriableStatus(error.status)) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
            await sleep(delay);
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
async function resolveSourceUrlPostback($: CheerioAPI, cookie: string | null, linkTarget: string): Promise<string | null> {
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
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
    resolveSourceUrl: boolean;
    state: DeltaState;
    now: Date;
    // Timeout-budget fix (see AGENTS.md "Timeout budget"): invoked the moment each tender
    // qualifies, instead of waiting for the whole (potentially maxItems=280-row, ~7-minute)
    // walk to finish before anything is pushed to the dataset. Returning { stop: true } (e.g.
    // Actor.pushData's own eventChargeLimitReached) breaks the walk immediately - both the
    // current page's row loop and further pagination - instead of the old behaviour of running
    // the entire remaining walk to completion and only then discovering the flag had been set.
    onTender?: (tender: TenderRow) => Promise<{ stop: boolean } | void>;
    // Same fix applied to delta state: called once per completed page with the full
    // observedThisRun snapshot so far, so a run that times out mid-walk still persists the
    // seen-set progress it made up to the last completed page, not just up to the last
    // successful dataset push. Safe to call repeatedly - saveState() replaces the whole
    // snapshot each time, so a later call simply supersedes an earlier one.
    onCheckpoint?: (observedSoFar: { id: string; entry: SeenEntry }[]) => Promise<void>;
}

export interface FetchTendersResult {
    tenders: TenderRow[];
    // Every raw numeroProceso walked this run (up to maxItems) with its current estado/hash,
    // regardless of whether onlyNew/dateRange/eventTypes kept it in `tenders` - this is what
    // gets persisted as "seen" for next run, matching the same precedent as
    // uk-hse-enforcement-monitor (a dateRange-excluded record was still genuinely observed,
    // so it shouldn't look "new" - or unchanged - again next time).
    observedThisRun: { id: string; entry: SeenEntry }[];
}

function classify(previous: SeenEntry | undefined, row: ParsedTenderRow, hash: string): EventType {
    if (!previous) return 'NEW_LISTING';
    if (previous.estado !== row.estado) return 'STATUS_CHANGE';
    if (previous.hash !== hash) return 'UPDATED';
    return 'UNCHANGED';
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
    const { maxItems, onlyNew, eventTypes, dateRange, resolveSourceUrl: shouldResolveSourceUrl, state, now, onTender, onCheckpoint } =
        options;
    const allowedEventTypes = eventTypes ? new Set<EventType>(eventTypes) : null;
    const scrapedAt = now.toISOString();

    const rawIds = new Set<string>(); // dedup + raw maxItems cap, same role the old `seenIds` Set played
    const tenders: TenderRow[] = [];
    const observedThisRun: { id: string; entry: SeenEntry }[] = [];
    let stopRequested = false;

    async function processRows(rows: ParsedTenderRow[], $: CheerioAPI, cookie: string | null): Promise<number> {
        let added = 0;
        for (const row of rows) {
            if (stopRequested) break;
            if (rawIds.size >= maxItems) break;
            if (rawIds.has(row.numeroProceso)) continue;
            rawIds.add(row.numeroProceso);
            added += 1;

            const hash = fingerprintOf(row);
            const previous = state.entries[row.numeroProceso];
            const eventType = classify(previous, row, hash);
            const isNew = !previous;
            observedThisRun.push({ id: row.numeroProceso, entry: { estado: row.estado, hash } });

            if (onlyNew && eventType === 'UNCHANGED') continue;
            if (allowedEventTypes && eventType !== 'UNCHANGED' && !allowedEventTypes.has(eventType)) continue;
            if (dateRange && !isWithinDateRange(parseFechaApertura(row.fechaApertura), dateRange, now)) continue;

            const sourceUrl =
                shouldResolveSourceUrl && row.linkTarget ? await resolveSourceUrlPostback($, cookie, row.linkTarget) : null;

            const tender: TenderRow = {
                sourceUrlResolved: sourceUrl !== null,
                numeroProceso: row.numeroProceso,
                nombreProceso: row.nombreProceso,
                tipoProceso: row.tipoProceso,
                fechaApertura: row.fechaApertura,
                estado: row.estado,
                unidadEjecutora: row.unidadEjecutora,
                servicioAdministrativoFinanciero: row.servicioAdministrativoFinanciero,
                monto: row.monto,
                record_id: row.numeroProceso,
                event_type: eventType,
                scraped_at: scrapedAt,
                is_new: isNew,
                contentHash: hash,
                // Degraded fallback if resolveSourceUrl=false, the per-row
                // permalink couldn't be resolved (missing link markup), or
                // the extra postback failed after retries - still a real,
                // useful URL (the search page itself), just not
                // process-specific. Disclosed in AGENTS.md/README, not
                // silently swallowed.
                source_url: sourceUrl ?? SEARCH_URL,
            };
            tenders.push(tender);

            // Timeout-budget fix: push this record now, not after the whole walk finishes -
            // see the FetchTendersOptions.onTender doc comment.
            const result = await onTender?.(tender);
            if (result?.stop) {
                stopRequested = true;
                break;
            }
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
    await onCheckpoint?.(observedThisRun);

    let previousFirstId = page1Rows[0]?.numeroProceso ?? null;

    for (let pageNum = 2; pageNum <= MAX_PAGES_SAFETY_CAP && rawIds.size < maxItems && !stopRequested; pageNum++) {
        const pagePayload = buildPostbackPayload($, GRID_TARGET, `Page$${pageNum}`);
        let response: ImpitResponse;
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
        await onCheckpoint?.(observedThisRun);
        if (pageNum % 20 === 0 || rows.length < PAGE_SIZE) {
            log.info(
                `Pagina ${pageNum}: ${rows.length} procesos (acumulado crudo: ${rawIds.size}, en salida: ${tenders.length})`,
            );
        }
    }

    return { tenders, observedThisRun };
}
