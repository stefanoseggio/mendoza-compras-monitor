# Mendoza Tenders Scraper & Monitor

**The tender-alert feed the Province of Mendoza never shipped.** Extracts every public procurement process (licitaciones, contrataciones directas) from the Province of Mendoza, Argentina's COMPR.AR-based portal (`comprar.mendoza.gov.ar`) - type, status, organism, opening date and budget per process, across a real backlog of 25,000+ processes - and keeps it fresh with a delta mode that reports what is genuinely **new, changed status, or amended**.

[![Mendoza Tenders Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/mendoza-compras-monitor)](https://apify.com/stefano_seggio/mendoza-compras-monitor)

- **Real lifecycle tracking, free.** `estado` (e.g. "Pendiente Análisis" -> "Adjudicado") is already in every row this actor walks - a status change is detected at zero extra cost and reported as `STATUS_CHANGE`.
- **Amendment detection, also free.** A changed monto, opening date or unidad ejecutora is fingerprinted from the same already-walked row and reported as `UPDATED`.
- **A real cost lever for the one expensive step.** Getting a process-specific permalink costs one extra request per record (this source has no plain link, only a session-bound postback) - `resolveSourceUrl: false` skips it for a much faster, cheaper run when you don't need it.

## Who uses Mendoza procurement data

| Team | Question they ask | Fields that answer it | Decision |
| --- | --- | --- | --- |
| Suppliers to provincial organisms (construction, health, IT, general services) | Did a tracked process get adjudicated, or its budget change? | `estado`, `event_type=STATUS_CHANGE`/`UPDATED`, `monto` | Re-check the offer, know when to stop chasing a closed process |
| Bid consultants and gestores managing several clients | What changed on my clients' tracked processes since yesterday? | `event_type`, `unidadEjecutora`, `source_url` | Notify the client with a direct link |
| Regional tender-data resellers / LATAM procurement platforms | A structured, change-aware Mendoza feed instead of a screen scrape | The whole envelope (`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`, `contentHash`) | Buy vs. build a scraper for a real ASP.NET postback session flow |
| Journalists, researchers, transparency groups | Which organisms run the most Contratación Directa (direct-award) processes? | `tipoProceso`, `unidadEjecutora`, `monto` | Spending-pattern analysis by organism and process type |

## Delta mode

Set `onlyNew: true` for recurring/scheduled monitoring and each run returns only processes that are `NEW_LISTING`, `STATUS_CHANGE` (estado changed) or `UPDATED` (a fingerprinted amendment). `eventTypes` narrows which of the three you want. Every record also always carries `is_new` (computed even on a plain non-delta run).

**Two real domain quirks, disclosed plainly:**

- This source's listing is sorted by **numero de proceso ascending** (each organism's own sequential counter, cycling through years), **not** newest-first - verified live. `onlyNew` is therefore a **safe post-filter** (walk up to `maxItems` raw processes exactly like a normal run, then drop what's unchanged), not an early-stop optimization. It does not resolve faster than a normal run, and a brand-new process is not guaranteed to appear within a small `maxItems` window - raise `maxItems` to cover more of the backlog.
- `dateRange` filters by `fechaApertura` (scheduled bid-opening date), which is routinely a **future** date for a currently open tender - it answers "opens/opened in the last N", not "listed in the last N". `onlyNew` is the more reliable "what's new" signal here.

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/mendoza-compras-monitor").call(run_input={"maxItems": 500, "onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['numeroProceso']} - {item['source_url']}")
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/mendoza-compras-monitor').call({ maxItems: 500, onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

Wire new results straight into Slack, Zapier, Make, or your own endpoint with Apify's native [dataset webhooks](https://docs.apify.com/platform/integrations/webhooks) - no custom webhook code lives inside the actor itself.

## What you get

Every record carries this standardized B2B integration envelope:

| Field | Type | Description |
| --- | --- | --- |
| `record_id` | string | Same value as `numeroProceso` - stable across runs |
| `event_type` | string | `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` / `UNCHANGED` |
| `contentHash` | string | sha1 fingerprint used to detect `UPDATED` |
| `scraped_at` | string | ISO-8601 timestamp of this extraction (same for every record in one run) |
| `is_new` | boolean | `true` if not seen in a prior run (delta mode) - set correctly even when `onlyNew` is off |
| `source_url` | string | Direct, cookie-independent link to the official process page (or the generic search page - see `sourceUrlResolved`) |
| `sourceUrlResolved` | boolean | Whether `source_url` is a genuine process-specific permalink |

Plus the full domain detail:

| Field | Description |
| --- | --- |
| `numeroProceso` | Process number, e.g. `10201-0001-CDI20` |
| `nombreProceso` | Process name/subject |
| `tipoProceso` | e.g. "Contratación Directa", "Licitación Pública" |
| `fechaApertura` | Scheduled bid-opening date and time |
| `estado` | Status, e.g. "Desierto", "Pendiente Análisis" |
| `unidadEjecutora` | Executing unit |
| `servicioAdministrativoFinanciero` | Administrative/financial service |
| `monto` | Budget amount, raw source format (Argentine comma decimal) |

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxItems` | integer | `100` | Hard cap on RAW processes walked this run. `onlyNew`/`dateRange`/`eventTypes` filter on top of this walk, so the number actually returned can be lower. |
| `onlyNew` | boolean | `false` | Delta mode - safe post-filter, see above |
| `eventTypes` | array | all three | Which of `NEW_LISTING`/`STATUS_CHANGE`/`UPDATED` to deliver when `onlyNew` is on |
| `resolveSourceUrl` | boolean | `true` | Resolve a process-specific permalink per record (one extra request each, ~1.5s) - disable for a much faster run, see below |
| `dateRange` | string | (none) | `"24h"` \| `"7d"` \| `"30d"` - filter by `fechaApertura` |

```json
{ "maxItems": 500, "onlyNew": true }
```

```json
{ "maxItems": 1000, "onlyNew": true, "resolveSourceUrl": false }
```

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~mendoza-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxItems": 100}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/mendoza-compras-monitor").call(run_input={"maxItems": 100})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["numeroProceso"], item["tipoProceso"], item["estado"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/mendoza-compras-monitor').call({ maxItems: 100 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## How much does it cost to monitor Mendoza tenders?

Pay per event, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | **$0.003** per record | `source_url` genuinely resolved this run (default `resolveSourceUrl: true`) |
| `result-summary` | **$0.001** per record | `resolveSourceUrl: false`, or the per-row postback failed/was missing |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 5 changes with `resolveSourceUrl: true` costs about $0.02/day (~$0.45/month); a `resolveSourceUrl: false` monitor over a large `maxItems` window is cheaper still and much faster, at the cost of a generic (not process-specific) link.

## Scope

Covers the full, unfiltered process list (25,000+ at audit time) - advanced search filters (date range, organism, process type) are not yet exposed as input; see `AGENTS.md` for why and what a future version could add.

## Known limitations

- **`source_url` costs one extra request per returned record when `resolveSourceUrl: true`** (the default). Each process row's link is a session-bound ASP.NET postback with no plain href, so getting a real, stable, clickable permalink means replaying that row's own postback once - genuinely more expensive than a listing that already exposes a plain link. Set `resolveSourceUrl: false` to skip this.
- `onlyNew` is a safe post-filter, not an early-stop optimization, because this source's listing is not sorted newest-first (see Delta mode above and `AGENTS.md`). It will not resolve faster than a normal run, and does not guarantee a brand-new process appears within a small `maxItems`.
- `dateRange` filters by `fechaApertura` (scheduled opening date), which can be a future date relative to publication - it answers "opens/opened in the last N", not "listed in the last N". `onlyNew` is the more reliable "what's new" signal here.
- **No `CLOSED` event**, unlike sibling actors on much smaller registers (Santa Fe, Salta). At 25,784+ total processes, only a complete census can trust "absent from this run = closed", and that census would take thousands of sequential postbacks - hours, not seconds. Considered and explicitly rejected rather than faked; see `AGENTS.md`.
- No proxy needed - reachable from a plain datacenter IP.
- Advanced search filters (date, organism, type) aren't exposed yet - every run pulls from the full unfiltered backlog.
- `monto` is a raw string, not a parsed number - keeps the source's exact formatting rather than risking a silent reformatting error.

Full technical detail - including why this COMPR.AR-based target turned out simpler than expected despite genuine DevExpress controls being present on the page, and the delta-engine's state/post-filter/source_url design - is in `AGENTS.md`.
