import { Actor } from 'apify';

// A NAMED key-value store (not the run's default one, which is isolated per
// run and would not survive between scheduled runs) persists which
// numeroProceso ids this actor has already returned. Mendoza has a single,
// homogeneous process listing (unlike uk-hse-enforcement-monitor's
// convictions/notices split), so the state shape here is the flat one the
// delta-engine spec describes as the default - no per-dataset keying
// needed.
const STATE_STORE_NAME = 'mendoza-compras-monitor-delta-state';
const MAX_SEEN_IDS = 2000;

export interface DeltaState {
    seenIds: string[];
    lastRunAt: string | null;
}

export async function loadState(): Promise<DeltaState> {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue<DeltaState>('state');
    return state ?? { seenIds: [], lastRunAt: null };
}

// Keeps every id seen THIS run (so a delta run's own discoveries are never
// evicted by the cap) and fills the remaining budget with previously-seen
// ids, oldest-added dropped first once MAX_SEEN_IDS is exceeded.
export async function saveState(previous: DeltaState, idsSeenThisRun: string[], runAt: string): Promise<DeltaState> {
    const merged = [...idsSeenThisRun, ...previous.seenIds.filter((id) => !idsSeenThisRun.includes(id))];
    const next: DeltaState = { seenIds: merged.slice(0, MAX_SEEN_IDS), lastRunAt: runAt };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
