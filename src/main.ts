import { Actor, log } from 'apify';

import { fetchTenders } from './fetchTenders.js';
import { loadState, saveState } from './state.js';
import type { ActorInput, TenderRow } from './types.js';

const EVENT_DETAIL = 'result';
const EVENT_SUMMARY = 'result-summary';

await Actor.init();
await run();
await Actor.exit();

async function run(): Promise<void> {
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    const { maxItems = 100, onlyNew = false, eventTypes, dateRange, resolveSourceUrl = true } = input;

    const now = new Date();
    const state = await loadState();

    // Timeout-budget fix (see AGENTS.md "Timeout budget"): both callbacks below make this run's
    // progress durable as it happens, instead of only after the entire (potentially multi-page)
    // walk finishes. Previously, fetchTenders() ran to completion and returned one big `tenders`
    // array that main() then pushed in a loop - so a run killed by the platform's 600s timeout
    // mid-walk lost every record gathered so far, not just the ones still to come. It also meant
    // `eventChargeLimitReached` below could only ever stop further dataset pushes, never the
    // (already-finished) network walk that produced them - dead code for its actual purpose.
    let pushed = 0;
    let stoppedOnChargeLimit = false;
    const byEventType: Record<string, number> = {};

    async function onTender(tender: TenderRow): Promise<{ stop: boolean }> {
        // pushData's own eventName argument performs the PPE charge - a separate
        // Actor.charge() call after it would double-charge the customer. Verified against the
        // installed apify SDK's own pushData(item, eventName): Promise<ChargeResult> overload
        // before writing this, not assumed - see AGENTS.md "Delta engine v2".
        const eventName = tender.sourceUrlResolved ? EVENT_DETAIL : EVENT_SUMMARY;
        const { eventChargeLimitReached } = await Actor.pushData(tender, eventName);
        pushed += 1;
        byEventType[tender.event_type] = (byEventType[tender.event_type] ?? 0) + 1;
        if (eventChargeLimitReached) {
            log.info('Charge limit reached - stopping the walk (not just further pushes).');
            stoppedOnChargeLimit = true;
        }
        return { stop: eventChargeLimitReached };
    }

    async function onCheckpoint(observedSoFar: Parameters<typeof saveState>[1]): Promise<void> {
        await saveState(state, observedSoFar, now.toISOString());
    }

    let tenders;
    try {
        const result = await fetchTenders({
            maxItems,
            onlyNew,
            eventTypes,
            dateRange,
            resolveSourceUrl,
            state,
            now,
            onTender,
            onCheckpoint,
        });
        tenders = result.tenders;
        // Final save: onCheckpoint already persisted progress after every completed page, but a
        // page that finishes mid-checkpoint-interval (e.g. the walk stops on charge limit, or on
        // 0 rows / repeated-first-row / maxItems reached, all of which happen between
        // checkpoints) still needs one last save covering everything observed this run.
        await saveState(state, result.observedThisRun, now.toISOString());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Fallo la extraccion: ${message}`);
        await Actor.pushData({ error: message, scraped_at: now.toISOString() });
        return;
    }

    log.info(
        `Total procesos extraidos: ${tenders.length} (onlyNew=${onlyNew}${dateRange ? `, dateRange=${dateRange}` : ''}, resolveSourceUrl=${resolveSourceUrl})`,
    );
    if (stoppedOnChargeLimit) return;

    log.info(
        `Cargados ${pushed} items al dataset (${Object.entries(byEventType)
            .map(([type, count]) => `${type}=${count}`)
            .join(', ')}).`,
    );
}
