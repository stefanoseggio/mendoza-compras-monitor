import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { buildPostbackPayload, extractFormFields } from '../../src/parsers/form.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('extractFormFields', () => {
    it('includes the core ASP.NET postback fields from a real captured page', () => {
        // Unlike cordoba-compras-monitor, this flow's captured responses
        // never include an __EVENTVALIDATION field at all - verified across
        // both real fixtures (0 occurrences) and confirmed harmless live
        // (pagination postbacks succeed without it), so its absence here is
        // a real, checked fact, not an oversight.
        const $ = loadFixture('page1.html');
        const fields = extractFormFields($);
        expect(fields.__VIEWSTATE).toBeTruthy();
        expect(fields.__VIEWSTATEGENERATOR).toBeTruthy();
        expect(fields.__EVENTVALIDATION).toBeUndefined();
    });
});

describe('buildPostbackPayload', () => {
    it('sets __EVENTTARGET/__EVENTARGUMENT for a page jump', () => {
        const $ = loadFixture('page1.html');
        const payload = buildPostbackPayload($, 'ctl00$CPH1$GridListaPliegos', 'Page$50');
        expect(payload.__EVENTTARGET).toBe('ctl00$CPH1$GridListaPliegos');
        expect(payload.__EVENTARGUMENT).toBe('Page$50');
        expect(payload.__VIEWSTATE).toBeTruthy();
    });

    it('defaults __EVENTARGUMENT to empty string when omitted', () => {
        const $ = loadFixture('page1.html');
        const payload = buildPostbackPayload($, 'ctl00$CPH1$btnListarPliegoAvanzado');
        expect(payload.__EVENTARGUMENT).toBe('');
    });
});
