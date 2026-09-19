import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Timeout-budget fix (see AGENTS.md "Timeout budget"): maxItems previously had no `maximum`,
// so nothing related the size of a raw walk to this actor's real, live defaultRunOptions.timeoutSecs
// (600s, confirmed via the Apify API). A healthy, resolveSourceUrl=true walk costs ~1.5s/row
// (measured live, see AGENTS.md and this same field's own description) - at maxItems=280 that is
// 280 x 1.5s = 420s, i.e. 70% of the 600s budget, with the remaining 180s as margin for
// pagination requests and the documented per-request retry/backoff policy. This test locks that
// real arithmetic to the actual schema file, not to a value re-typed by hand elsewhere, so the
// two can never silently drift apart again.
const schemaPath = fileURLToPath(new URL('../.actor/input_schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
    properties: { maxItems: { minimum?: number; maximum?: number; default?: number } };
};

const REAL_TIMEOUT_SECS = 600; // live defaultRunOptions.timeoutSecs, confirmed via GET /v2/acts/...
const REAL_SECONDS_PER_ROW = 1.5; // documented, measured cost of the resolveSourceUrl postback
const BUDGET_FRACTION = 0.7; // worst case must fit within 70% of the real timeout, not 100%

function fitsWithinTimeoutBudget(maxItems: number): boolean {
    return maxItems * REAL_SECONDS_PER_ROW <= REAL_TIMEOUT_SECS * BUDGET_FRACTION;
}

describe('input_schema.json maxItems timeout-budget cap', () => {
    it('declares a maximum (previously absent - this is the confirmed timeout-budget bug)', () => {
        expect(schema.properties.maxItems.maximum).toBeDefined();
    });

    it('the declared maximum is exactly the real-arithmetic boundary (280), not an arbitrary round number', () => {
        expect(schema.properties.maxItems.maximum).toBe(280);
    });

    it('a run at the maximum fits inside 70% of the real 600s timeoutSecs budget', () => {
        const max = schema.properties.maxItems.maximum!;
        expect(fitsWithinTimeoutBudget(max)).toBe(true);
        expect(max * REAL_SECONDS_PER_ROW).toBeLessThanOrEqual(REAL_TIMEOUT_SECS * BUDGET_FRACTION);
    });

    it('one step past the maximum would already miss the 70% budget - proving 280 is the real boundary, not just "a" safe value', () => {
        const max = schema.properties.maxItems.maximum!;
        expect(fitsWithinTimeoutBudget(max + 1)).toBe(false);
    });

    it('the default (20) stays comfortably under the new maximum', () => {
        expect(schema.properties.maxItems.default).toBeLessThanOrEqual(schema.properties.maxItems.maximum!);
    });
});
