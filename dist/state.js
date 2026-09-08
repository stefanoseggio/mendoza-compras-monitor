import { Actor } from 'apify';
// A NAMED key-value store (not the run's default one, which is isolated per
// run and would not survive between scheduled runs) persists which
// numeroProceso ids this actor has already returned, and their last-known
// estado + content fingerprint.
const STATE_STORE_NAME = 'mendoza-compras-monitor-delta-state';
const MAX_SEEN_IDS = 2000;
const EMPTY_STATE = { entries: {}, lastRunAt: null };
function isValidState(value) {
    if (!value || typeof value !== 'object')
        return false;
    const v = value;
    return typeof v.entries === 'object' && v.entries !== null;
}
export async function loadState() {
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    const state = await store.getValue('state');
    // A v1-shaped state ({ seenIds: string[] }) fails isValidState and is treated as absent -
    // the first v2 run on an existing schedule re-baselines rather than crashing on the old
    // shape. Disclosed in CHANGELOG.md.
    return isValidState(state) ? state : { ...EMPTY_STATE };
}
// Keeps every id observed THIS run (so a delta run's own discoveries are never evicted by the
// cap) and fills the remaining budget with previously-persisted entries, oldest-added dropped
// first once MAX_SEEN_IDS is exceeded.
export async function saveState(previous, observedThisRun, runAt) {
    const entries = { ...previous.entries };
    for (const { id, entry } of observedThisRun)
        entries[id] = entry;
    const observedIds = new Set(observedThisRun.map((o) => o.id));
    const order = [...observedThisRun.map((o) => o.id), ...Object.keys(previous.entries).filter((id) => !observedIds.has(id))];
    const cappedIds = order.slice(0, MAX_SEEN_IDS);
    const cappedEntries = {};
    for (const id of cappedIds)
        cappedEntries[id] = entries[id];
    const next = { entries: cappedEntries, lastRunAt: runAt };
    const store = await Actor.openKeyValueStore(STATE_STORE_NAME);
    await store.setValue('state', next);
    return next;
}
//# sourceMappingURL=state.js.map