import { type DateRangePreset } from './dateFilter.js';
import type { DeltaState, SeenEntry } from './state.js';
import type { EventType, TenderRow } from './types.js';
export interface FetchTendersOptions {
    maxItems: number;
    onlyNew: boolean;
    eventTypes?: Exclude<EventType, 'UNCHANGED'>[];
    dateRange?: DateRangePreset;
    resolveSourceUrl: boolean;
    state: DeltaState;
    now: Date;
}
export interface FetchTendersResult {
    tenders: TenderRow[];
    observedThisRun: {
        id: string;
        entry: SeenEntry;
    }[];
}
export declare function fetchTenders(options: FetchTendersOptions): Promise<FetchTendersResult>;
//# sourceMappingURL=fetchTenders.d.ts.map