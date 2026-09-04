# Mendoza Compras Monitor

Extracts **public procurement processes** (licitaciones, contrataciones
directas) from the Province of Mendoza, Argentina's COMPR.AR-based portal
- type, status, organism, opening date and budget per process.

## What you get

| Field | Description |
|---|---|
| `numeroProceso` | Process number, e.g. `10201-0001-CDI20` |
| `nombreProceso` | Process name/subject |
| `tipoProceso` | e.g. "Contratación Directa", "Licitación Pública" |
| `fechaApertura` | Opening date and time |
| `estado` | Status, e.g. "Desierto", "Pendiente Análisis" |
| `unidadEjecutora` | Executing unit |
| `servicioAdministrativoFinanciero` | Administrative/financial service |
| `monto` | Budget amount, raw source format (Argentine comma decimal) |
| `scrapedAt` | ISO timestamp of extraction |

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `maxItems` | integer | `100` | Hard cap on processes returned this run |

```json
{ "maxItems": 100 }
```

## Scope

Covers the full, unfiltered process list (25,000+ at audit time) -
advanced search filters (date range, organism, process type) are not yet
exposed as input; see `AGENTS.md` for why and what a future version could
add.

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

## Known limitations

- No proxy needed - reachable from a plain datacenter IP.
- Advanced search filters (date, organism, type) aren't exposed yet -
  every run pulls from the full unfiltered backlog.
- `monto` is a raw string, not a parsed number - keeps the source's exact
  formatting rather than risking a silent reformatting error.

Full technical detail - including why this COMPR.AR-based target turned
out simpler than expected despite genuine DevExpress controls being
present on the page - is in `AGENTS.md`.
