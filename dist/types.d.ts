import type { DateRangePreset } from './dateFilter.js';
/**
 * NEW_LISTING: numeroProceso never seen before. STATUS_CHANGE: seen before, `estado` differs
 * from last time (e.g. "Pendiente Análisis" -> "Adjudicado") - a real lifecycle transition,
 * free to detect since estado is already in the grid row. UPDATED: seen before, same estado,
 * but the content fingerprint differs (a changed monto, fecha, unidad ejecutora...). UNCHANGED:
 * seen before, same estado, same fingerprint - only ever produced on a full (onlyNew=false)
 * run. There is deliberately no CLOSED event here (unlike santafe/salta): at ~25,000+ total
 * processes, a complete census would take thousands of sequential postbacks - hours, not
 * seconds - so "absent from this run's walk" can never be trusted as "no longer listed" the
 * way it can on a ~250-register source. See AGENTS.md "Delta engine v2".
 */
export type EventType = 'NEW_LISTING' | 'STATUS_CHANGE' | 'UPDATED' | 'UNCHANGED';
export interface ActorInput {
    maxItems: number;
    onlyNew: boolean;
    /** Which event types to deliver when onlyNew=true. Ignored (everything delivered) when onlyNew=false. */
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
    /**
     * When true (default), resolves each delivered record's own permalink via one extra
     * postback per row (~1.5s each - see AGENTS.md). Set false to skip it: much faster for a
     * large maxItems run, at the cost of source_url falling back to the plain search page for
     * every record instead of a process-specific link. Charged at the cheaper result-summary
     * rate - see README "How much does it cost".
     */
    resolveSourceUrl: boolean;
}
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
    record_id: string;
    event_type: EventType;
    scraped_at: string;
    is_new: boolean;
    source_url: string;
    /** True when source_url is a genuine process-specific permalink (resolved via the extra
     *  postback); false when it's the generic search-page fallback (resolveSourceUrl=false,
     *  missing link markup, or the postback failed). Determines the PPE tier - see main.ts. */
    sourceUrlResolved: boolean;
    /** sha1 content fingerprint as of this run - see src/fingerprint.ts. */
    contentHash: string;
}
export type FormFields = Record<string, string>;
//# sourceMappingURL=types.d.ts.map