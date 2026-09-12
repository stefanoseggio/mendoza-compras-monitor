// run-monitor.js
// Calls the Mendoza Tender Delta Actor via the Apify API and logs new/changed tender records.
const { ApifyClient } = require('apify-client');

const client = new ApifyClient({
    token: process.env.APIFY_TOKEN, // set this to your Apify API token
});

async function main() {
    const input = {
        maxItems: 500,
        onlyNew: true,
        eventTypes: ['NEW_LISTING', 'STATUS_CHANGE', 'UPDATED'],
        resolveSourceUrl: true,
    };

    // Starts the run and waits for it to finish
    const run = await client.actor('bb4cRgt1i27hvr9Ug').call(input);
    console.log(`Run ${run.id} finished with status: ${run.status}`);

    // Fetch the delivered tender records for this run
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`Delivered ${items.length} tender record(s):`);
    for (const item of items) {
        console.log(`- [${item.event_type}] ${item.numeroProceso}: ${item.nombreProceso} (${item.estado})`);
    }
}

main().catch((err) => {
    console.error('Run failed:', err);
    process.exit(1);
});
