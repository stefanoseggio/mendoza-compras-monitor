import { createHash } from 'node:crypto';

import type { ParsedTenderRow } from './types.js';

/**
 * A stable content fingerprint of a grid row's mutable fields - everything that can change
 * while a process keeps the same numeroProceso and estado. Excludes numeroProceso (identity)
 * and linkTarget (internal postback plumbing, never pushed). Free to compute: every field is
 * already present in the grid row this actor walks every run, no extra request needed.
 */
export function fingerprintOf(row: ParsedTenderRow): string {
    const stable = {
        nombreProceso: row.nombreProceso,
        tipoProceso: row.tipoProceso,
        fechaApertura: row.fechaApertura,
        estado: row.estado,
        unidadEjecutora: row.unidadEjecutora,
        servicioAdministrativoFinanciero: row.servicioAdministrativoFinanciero,
        monto: row.monto,
    };
    return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}
