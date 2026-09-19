# run_monitor.py
# Calls the Mendoza Tender Delta Actor via the Apify API and logs new/changed tender records.
import os
from apify_client import ApifyClient

client = ApifyClient(os.environ["APIFY_TOKEN"])  # set this to your Apify API token

run_input = {
    "maxItems": 250,
    "onlyNew": True,
    "eventTypes": ["NEW_LISTING", "STATUS_CHANGE", "UPDATED"],
    "resolveSourceUrl": True,
}

# Starts the run and waits for it to finish
run = client.actor("bb4cRgt1i27hvr9Ug").call(run_input=run_input)
print(f"Run {run['id']} finished with status: {run['status']}")

# Fetch the delivered tender records for this run
dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items
print(f"Delivered {len(dataset_items)} tender record(s):")
for item in dataset_items:
    print(f"- [{item['event_type']}] {item['numeroProceso']}: {item['nombreProceso']} ({item['estado']})")
