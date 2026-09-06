import { Actor, log } from 'apify';

import { fetchTenders } from './fetchTenders.js';
import { loadState, saveState } from './state.js';
import type { ActorInput } from './types.js';

const RESULT_EVENT_NAME = 'result';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 100, onlyNew = false, dateRange } = input;

    const now = new Date();
    const state = await loadState();
    const seenIds = new Set(state.seenIds);

    let tenders;
    let allIdsThisRun: string[];
    try {
        const result = await fetchTenders({ maxItems, onlyNew, dateRange, seenIds, now });
        tenders = result.tenders;
        allIdsThisRun = result.allIdsThisRun;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Fallo la extraccion: ${message}`);
        await Actor.pushData({ error: message, scraped_at: now.toISOString() });
        return;
    }

    log.info(
        `Total procesos extraidos: ${tenders.length} (onlyNew=${onlyNew}${dateRange ? `, dateRange=${dateRange}` : ''})`,
    );

    let pushed = 0;
    for (const tender of tenders) {
        await Actor.pushData(tender);
        pushed += 1;

        const { eventChargeLimitReached } = await Actor.charge({ eventName: RESULT_EVENT_NAME, count: 1 });
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping.');
            await saveState(state, allIdsThisRun, now.toISOString());
            return;
        }
    }

    await saveState(state, allIdsThisRun, now.toISOString());
    log.info(`Cargados ${pushed} items al dataset.`);
}
