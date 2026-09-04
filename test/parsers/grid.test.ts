import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { parseGrid } from '../../src/parsers/grid.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

function loadFixture(name: string) {
    return cheerio.load(readFileSync(`${fixturesDir}/${name}`, 'utf-8'));
}

describe('parseGrid', () => {
    it('extracts all 10 rows from a real page 1 capture, with correct fields', () => {
        const $ = loadFixture('page1.html');
        const rows = parseGrid($);

        expect(rows).toHaveLength(10);

        const first = rows[0];
        expect(first.numeroProceso).toBe('10201-0001-CDI20');
        expect(first.nombreProceso).toContain('ALQUILER DE UN INMUEBLE');
        expect(first.tipoProceso).toBe('Contratación Directa');
        expect(first.fechaApertura).toBe('16/03/2020 10:00 Hrs.');
        expect(first.estado).toBe('Desierto');
        expect(first.unidadEjecutora).toContain('Suprema Corte');
        expect(first.servicioAdministrativoFinanciero).toContain('Hab. Poder Judicial');
        expect(first.monto).toBe('1869000,00');
    });

    it('every row has a well-formed numeroProceso and non-empty core fields', () => {
        const $ = loadFixture('page1.html');
        const rows = parseGrid($);
        for (const row of rows) {
            expect(row.numeroProceso.length).toBeGreaterThan(0);
            expect(row.tipoProceso.length).toBeGreaterThan(0);
            expect(row.estado.length).toBeGreaterThan(0);
        }
    });

    it('extracts a different set of rows from page 2, no overlap with page 1', () => {
        const $1 = loadFixture('page1.html');
        const $2 = loadFixture('page2.html');
        const ids1 = parseGrid($1).map((r) => r.numeroProceso);
        const ids2 = parseGrid($2).map((r) => r.numeroProceso);

        expect(ids2).toHaveLength(10);
        for (const id of ids2) {
            expect(ids1).not.toContain(id);
        }
    });

    it('returns an empty array on a page with no data rows', () => {
        const $ = loadFixture('page_no_results.html');
        const rows = parseGrid($);
        expect(rows).toHaveLength(0);
    });
});
