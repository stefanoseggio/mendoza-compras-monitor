import type { CheerioAPI } from 'cheerio';

import type { ParsedTenderRow } from '../types.js';

// Results grid, id="ctl00_CPH1_GridListaPliegos" - a classic ASP.NET
// GridView (explicit <thead>/<tbody>, not DevExpress's ASPxGridView), 8
// columns matching the header exactly: Numero proceso, Nombre proceso,
// Tipo de Proceso, Fecha de apertura, Estado, Unidad Ejecutora, Servicio
// Administrativo Financiero, Monto. Several cells wrap their text in a
// <p>, others don't - .text() on the <td> itself handles both uniformly.
//
// The first cell's <a id="..."> is a client-postback link
// (href="javascript:__doPostBack('ctl00$CPH1$GridListaPliegos$ctlNN$lnkNumeroProceso','')"),
// not a real navigable URL - clicking it server-side redirects to a
// standalone, cookie-independent permalink
// (PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=<token>), verified live
// 2026-09-06. `linkTarget` captures the ClientID-derived __EVENTTARGET
// (id with every "_" turned back into "$") so fetchTenders.ts can replay
// that same postback to resolve source_url - see AGENTS.md.
export function parseGrid($: CheerioAPI): ParsedTenderRow[] {
    const rows: ParsedTenderRow[] = [];

    $('table#ctl00_CPH1_GridListaPliegos > tbody > tr').each((_i, el) => {
        const cells = $(el).children('td');
        if (cells.length < 8) return;

        const numeroCell = cells.eq(0);
        const numeroProceso = numeroCell.text().trim();
        if (!numeroProceso) return;

        const linkId = numeroCell.find('a').attr('id');
        const linkTarget = linkId ? linkId.replace(/_/g, '$') : null;

        rows.push({
            numeroProceso,
            nombreProceso: cells.eq(1).text().trim(),
            tipoProceso: cells.eq(2).text().trim(),
            fechaApertura: cells.eq(3).text().trim(),
            estado: cells.eq(4).text().trim(),
            unidadEjecutora: cells.eq(5).text().trim(),
            servicioAdministrativoFinanciero: cells.eq(6).text().trim(),
            monto: cells.eq(7).text().trim(),
            linkTarget,
        });
    });

    return rows;
}
