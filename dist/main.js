import { Actor, log } from 'apify';
import { fetchTenders } from './fetchTenders.js';
import { loadState, saveState } from './state.js';
const EVENT_DETAIL = 'result';
const EVENT_SUMMARY = 'result-summary';
await Actor.init();
await run();
await Actor.exit();
async function run() {
    const input = (await Actor.getInput()) ?? {};
    const { maxItems = 100, onlyNew = false, eventTypes, dateRange, resolveSourceUrl = true } = input;
    const now = new Date();
    const state = await loadState();
    let tenders;
    let observedThisRun;
    try {
        const result = await fetchTenders({ maxItems, onlyNew, eventTypes, dateRange, resolveSourceUrl, state, now });
        tenders = result.tenders;
        observedThisRun = result.observedThisRun;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Fallo la extraccion: ${message}`);
        await Actor.pushData({ error: message, scraped_at: now.toISOString() });
        return;
    }
    log.info(`Total procesos extraidos: ${tenders.length} (onlyNew=${onlyNew}${dateRange ? `, dateRange=${dateRange}` : ''}, resolveSourceUrl=${resolveSourceUrl})`);
    let pushed = 0;
    const byEventType = {};
    for (const tender of tenders) {
        // pushData's own eventName argument performs the PPE charge - a separate
        // Actor.charge() call after it would double-charge the customer. Verified against the
        // installed apify SDK's own pushData(item, eventName): Promise<ChargeResult> overload
        // before writing this, not assumed - see AGENTS.md "Delta engine v2".
        const eventName = tender.sourceUrlResolved ? EVENT_DETAIL : EVENT_SUMMARY;
        const { eventChargeLimitReached } = await Actor.pushData(tender, eventName);
        pushed += 1;
        byEventType[tender.event_type] = (byEventType[tender.event_type] ?? 0) + 1;
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            await saveState(state, observedThisRun, now.toISOString());
            return;
        }
    }
    await saveState(state, observedThisRun, now.toISOString());
    log.info(`Cargados ${pushed} items al dataset (${Object.entries(byEventType)
        .map(([type, count]) => `${type}=${count}`)
        .join(', ')}).`);
}
//# sourceMappingURL=main.js.map