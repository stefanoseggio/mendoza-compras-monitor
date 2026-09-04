export interface ActorInput {
    maxItems: number;
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
    scrapedAt: string;
}

export type FormFields = Record<string, string>;
