import type { DateRangePreset } from './dateFilter.js';

export type EventType = 'NEW_LISTING';

export interface ActorInput {
    maxItems: number;
    onlyNew: boolean;
    dateRange?: DateRangePreset;
}

// Raw fields parsed straight off the results grid, before the standardized
// B2B envelope is attached. `linkTarget` is the row's own __EVENTTARGET
// (derived from its <a id="..."> postback link) used to resolve source_url
// via one extra postback - see fetchTenders.ts. It is internal plumbing,
// never pushed to the dataset as-is.
export interface ParsedTenderRow {
    numeroProceso: string;
    nombreProceso: string;
    tipoProceso: string;
    fechaApertura: string;
    estado: string;
    unidadEjecutora: string;
    servicioAdministrativoFinanciero: string;
    monto: string;
    linkTarget: string | null;
}

export interface TenderRow {
    numeroProceso: string;
    nombreProceso: string;
    tipoProceso: string;
    fechaApertura: string;
    estado: string;
    unidadEjecutora: string;
    servicioAdministrativoFinanciero: string;
    monto: string;
    // Standardized B2B integration envelope - consistent across this
    // portfolio's fleet (see uk-hse-enforcement-monitor for the origin of
    // this contract).
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
}

export type FormFields = Record<string, string>;
