# Mendoza Compras Monitor

Extracts **public procurement processes** (licitaciones, contrataciones
directas) from the Province of Mendoza, Argentina's COMPR.AR-based portal

- type, status, organism, opening date and budget per process.

## Delta mode - recurring B2B monitoring, not just a dump

Set `onlyNew: true` and this actor persists which `numeroProceso` ids it has
already returned (in its own private key-value store, independent of any
single run) and, on every subsequent run, keeps only the ones not seen
before.

```json
{ "maxItems": 500, "onlyNew": true }
```

**Read this before relying on it for Mendoza specifically**: this source's
listing is sorted by **numero de proceso ascending** (each organism's own
sequential counter, cycling through years) - verified live, **not** by date
and **not** newest-first. Because of that, `onlyNew` here is a **safe
post-filter** (walk up to `maxItems` raw processes exactly like a normal
run, then drop the ones already seen), not an early-stop optimization - it
does not make pagination resolve faster, and a brand-new process is not
guaranteed to show up within a small `maxItems` window at all, since its
position in the list depends on its own organism's counter, not on when it
was published. Raise `maxItems` to cover more of the backlog for a delta
run to actually surface new processes reliably. See `AGENTS.md` for the
live evidence behind this and why it's the honest choice over a fast but
wrong early-stop.

Prefer filtering by the source's own date field instead of run history? Use
`dateRange` (`"24h"`, `"7d"`, or `"30d"`) - independent of `onlyNew`, though
note `fechaApertura` ("Fecha de apertura") is the process's **scheduled
bid-opening date**, not when it was published on the portal - a currently
open tender is routinely dated in the future relative to today, so this
answers "opens/opened in the last N", not "listed in the last N".

Run this on an [Apify schedule](https://docs.apify.com/platform/schedules)
and pipe the output into Slack/Email/Zapier/Make/your own endpoint via
[Apify's native dataset webhooks](https://docs.apify.com/platform/integrations/webhooks)

- every record already carries the standardized integration envelope below,
  so no intermediate parser is needed.

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")

# Daily monitoring run - only genuinely new processes come back
run = client.actor("stefano_seggio/mendoza-compras-monitor").call(run_input={"maxItems": 500, "onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['numeroProceso']} - {item['source_url']}")
    # -> forward `item` as-is to your webhook/Slack/CRM; the record_id/
    #    event_type/scraped_at/source_url envelope needs no reshaping.
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });

// Daily monitoring run
const run = await client.actor('stefano_seggio/mendoza-compras-monitor').call({ maxItems: 500, onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
for (const item of items) {
    // item.record_id / item.event_type / item.scraped_at / item.source_url
    // are already webhook/Zapier/Make-ready - post `item` straight through.
}
```

**Webhook / Zapier / Make**: configure an [Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks)
on `ACTOR.RUN.SUCCEEDED` for this actor and point it at your endpoint - the
standardized `record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`
envelope on every item means no custom parser is needed on the receiving
end. Do not build custom webhook-sending code inside the actor itself -
that's what Apify's own webhooks are for.

## What you get

Every record carries this standardized B2B integration envelope:

| Field        | Type    | Description                                                                               |
| ------------ | ------- | ----------------------------------------------------------------------------------------- |
| `record_id`  | string  | Same value as `numeroProceso` - stable across runs                                        |
| `event_type` | string  | `NEW_LISTING` for every process                                                           |
| `scraped_at` | string  | ISO-8601 timestamp of this extraction (same for every record in one run)                  |
| `is_new`     | boolean | `true` if not seen in a prior run (delta mode) - set correctly even when `onlyNew` is off |
| `source_url` | string  | Direct, cookie-independent link to the official process page                              |

Plus the full domain detail:

| Field                              | Description                                                |
| ---------------------------------- | ---------------------------------------------------------- |
| `numeroProceso`                    | Process number, e.g. `10201-0001-CDI20`                    |
| `nombreProceso`                    | Process name/subject                                       |
| `tipoProceso`                      | e.g. "Contratación Directa", "Licitación Pública"          |
| `fechaApertura`                    | Scheduled bid-opening date and time                        |
| `estado`                           | Status, e.g. "Desierto", "Pendiente Análisis"              |
| `unidadEjecutora`                  | Executing unit                                             |
| `servicioAdministrativoFinanciero` | Administrative/financial service                           |
| `monto`                            | Budget amount, raw source format (Argentine comma decimal) |

## Input

| Field       | Type    | Default | Description                                                                                                                                |
| ----------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxItems`  | integer | `100`   | Hard cap on RAW processes walked this run. `onlyNew`/`dateRange` filter on top of this walk, so the number actually returned can be lower. |
| `onlyNew`   | boolean | `false` | Delta mode - safe post-filter, see above                                                                                                   |
| `dateRange` | string  | (none)  | `"24h"` \| `"7d"` \| `"30d"` - filter by `fechaApertura`                                                                                   |

```json
{ "maxItems": 100, "onlyNew": false }
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

## Scope

Covers the full, unfiltered process list (25,000+ at audit time) -
advanced search filters (date range, organism, process type) are not yet
exposed as input; see `AGENTS.md` for why and what a future version could
add.

## Known limitations

- **`source_url` costs one extra request per returned record.** Each
  process row's link is a session-bound ASP.NET postback with no plain
  href, so getting a real, stable, clickable permalink to the specific
  process (`PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=...`, verified live
  to work with zero cookies afterward) means replaying that row's own
  postback once. This is genuinely more expensive than a listing that
  already exposes a plain link - a default 100-item run now makes roughly
  110 sequential requests instead of 10, so it takes noticeably longer
  (a few minutes rather than seconds). See `AGENTS.md` for the live
  measurements and why this was still the right call over a fake or
  omitted `source_url`.
- `onlyNew` is a safe post-filter, not an early-stop optimization, because
  this source's listing is not sorted newest-first (see "Delta mode"
  above and `AGENTS.md` for the live evidence). It will not resolve faster
  than a normal run, and does not guarantee a brand-new process appears
  within a small `maxItems`.
- `dateRange` filters by `fechaApertura` (scheduled opening date), which
  can be a future date relative to publication for a currently open
  tender - it answers "opens/opened in the last N", not "listed in the
  last N". `onlyNew` is the more reliable "what's new" signal here.
- `event_type` currently only distinguishes "process appearing in this
  run's output" (`NEW_LISTING`) - it does not diff field-level changes to
  a previously-seen process (e.g. `estado` moving from "Pendiente Análisis"
  to "Adjudicado"). That would need full snapshot storage and diffing, a
  materially bigger feature deferred for now.
- No proxy needed - reachable from a plain datacenter IP.
- Advanced search filters (date, organism, type) aren't exposed yet -
  every run pulls from the full unfiltered backlog.
- `monto` is a raw string, not a parsed number - keeps the source's exact
  formatting rather than risking a silent reformatting error.

Full technical detail - including why this COMPR.AR-based target turned
out simpler than expected despite genuine DevExpress controls being
present on the page, and the delta-engine's state/post-filter/source_url
design - is in `AGENTS.md`.
