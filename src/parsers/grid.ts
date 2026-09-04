import type { CheerioAPI } from 'cheerio';

import type { TenderRow } from '../types.js';

// Results grid, id="ctl00_CPH1_GridListaPliegos" - a classic ASP.NET
// GridView (explicit <thead>/<tbody>, not DevExpress's ASPxGridView), 8
// columns matching the header exactly: Numero proceso, Nombre proceso,
// Tipo de Proceso, Fecha de apertura, Estado, Unidad Ejecutora, Servicio
// Administrativo Financiero, Monto. Several cells wrap their text in a
// <p>, others don't - .text() on the <td> itself handles both uniformly.
export function parseGrid($: CheerioAPI): TenderRow[] {
    const rows: TenderRow[] = [];
    const scrapedAt = new Date().toISOString();

    $('table#ctl00_CPH1_GridListaPliegos > tbody > tr').each((_i, el) => {
        const cells = $(el).children('td');
        if (cells.length < 8) return;

        const numeroProceso = cells.eq(0).text().trim();
        if (!numeroProceso) return;

        rows.push({
            numeroProceso,
            nombreProceso: cells.eq(1).text().trim(),
            tipoProceso: cells.eq(2).text().trim(),
            fechaApertura: cells.eq(3).text().trim(),
            estado: cells.eq(4).text().trim(),
            unidadEjecutora: cells.eq(5).text().trim(),
            servicioAdministrativoFinanciero: cells.eq(6).text().trim(),
            monto: cells.eq(7).text().trim(),
            scrapedAt,
        });
    });

    return rows;
}
