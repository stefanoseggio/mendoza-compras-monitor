/** v2: last-known estado + content fingerprint per id, not just a bare seen flag - this is
 *  what makes STATUS_CHANGE (estado differs) and UPDATED (hash differs, same estado) possible.
 *  Both fields come from the already-walked grid row, at zero extra request cost. */
export interface SeenEntry {
    estado: string;
    hash: string;
}
export interface DeltaState {
    entries: Record<string, SeenEntry>;
    lastRunAt: string | null;
}
export declare function loadState(): Promise<DeltaState>;
export declare function saveState(previous: DeltaState, observedThisRun: {
    id: string;
    entry: SeenEntry;
}[], runAt: string): Promise<DeltaState>;
//# sourceMappingURL=state.d.ts.map