# Mendoza Government Tenders Monitor - Argentina Public Procurement (Licitaciones)

## Executive Value Proposition

Tracking the Province of Mendoza's procurement register by hand means opening `comprar.mendoza.gov.ar`'s advanced search, working through a session-bound ASP.NET postback flow with no plain links to bookmark, and re-reading a 25,000+ process backlog every time you want to know whether a tracked licitación changed status or its budget was amended. This actor automates that walk and adds two checks the portal never surfaces on its own: an `estado` change (e.g. "Pendiente Análisis" -> "Adjudicado") and a content amendment (`monto`, `fechaApertura`, `unidadEjecutora` or any other tracked field) are both detected from the same row this actor already reads, at no extra request cost. Turn on delta mode (`onlyNew`) for a recurring or scheduled run and each execution reports only what is genuinely new, status-changed or amended - not a re-dump of the whole register.

## Who Uses Mendoza Procurement Data

- **Suppliers to provincial organisms** (construction, health, IT, general services) tracking their own submitted bids. `estado`, `event_type` (`STATUS_CHANGE`/`UPDATED`) and `monto` tell them the moment a tracked process is adjudicated or its budget changes, so they know when to re-check an offer or stop chasing a closed one.
- **Bid consultants and gestores managing several client accounts** who need to know what changed across all of their clients' tracked processes since the last run. `event_type`, `unidadEjecutora` and `source_url` let them notify each client with a direct link to the process, instead of re-opening the search form per client.
- **Journalists, researchers and transparency groups** studying provincial spending patterns. `tipoProceso`, `unidadEjecutora` and `monto` support questions like which organism runs the most Contratación Directa (direct-award, lower-scrutiny) processes versus competitive Licitación Pública processes.

## Input

```json
{ "maxItems": 500, "onlyNew": true }
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxItems` | integer | `100` | Hard cap on RAW processes walked this run (10 per page, 25,000+ total at audit time). `onlyNew`/`dateRange`/`eventTypes` filter on top of this walk, so the number actually returned can be lower. |
| `onlyNew` | boolean | `false` | Delta mode. Persists which `numeroProceso` ids this actor has already returned - and their last-known `estado` and content fingerprint - in a named key-value store that survives between scheduled runs, then delivers only what's new, status-changed or amended. It is a safe post-filter, not an early-stop optimization: the source's listing is sorted by numero de proceso ascending, not newest-first. |
| `eventTypes` | array | all three | Which of `NEW_LISTING` / `STATUS_CHANGE` / `UPDATED` to deliver when `onlyNew` is on. |
| `resolveSourceUrl` | boolean | `true` | Resolves each delivered record's own permalink via one extra postback per row (~1.5s each). Disable for a much faster run when a process-specific link isn't needed; `source_url` then falls back to the plain search page and delivery is billed at the cheaper `result-summary` rate. |
| `dateRange` | string | (none) | `"24h"` \| `"7d"` \| `"30d"` - filters by `fechaApertura` (scheduled bid-opening date), which is routinely a future date for a currently open tender. `onlyNew` is the more reliable "what's new" signal. |

## Output

```json
{
  "numeroProceso": "10201-0001-CDI20",
  "nombreProceso": "Adquisición de insumos varios",
  "tipoProceso": "Contratación Directa",
  "fechaApertura": "15/09/2026 10:00",
  "estado": "Pendiente Análisis",
  "unidadEjecutora": "Ministerio de Salud",
  "servicioAdministrativoFinanciero": "SAF Salud",
  "monto": "1.250.000,50",
  "record_id": "10201-0001-CDI20",
  "event_type": "NEW_LISTING",
  "contentHash": "3f9a1c2b8e7d4f0a9c6b5d2e1f8a7c4b6d3e9f01",
  "scraped_at": "2026-09-09T08:00:00.000Z",
  "is_new": true,
  "sourceUrlResolved": true,
  "source_url": "https://comprar.mendoza.gov.ar/PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=..."
}
```

`record_id` is `numeroProceso` verbatim - already the domain's own unique id, stable across runs. `event_type` is `NEW_LISTING` (never seen before), `STATUS_CHANGE` (`estado` changed since last seen), `UPDATED` (a tracked field changed, same `estado`) or `UNCHANGED` (only appears with `onlyNew` off). `monto` is left as the source's raw Argentine comma-decimal string rather than parsed into a number, to avoid a silent reformatting error. The dataset ships two built-in views: an overview table and a "Status changes & amendments" table pre-filtered to the change-relevant fields.

## Reliability

Every HTTP request in the session - the initial home-page GET, the search-landing POST, each `Page$N` pagination POST, and each per-row detail postback used to resolve `source_url` - goes through a shared retry helper with exponential backoff: up to 4 retries, starting at a 1-second delay and doubling each attempt. The site's session state (`ASP.NET_SessionId` plus a second opaque cookie the server also sets) is captured from response headers and forwarded on every request, since the whole search flow depends on that session staying valid across the sequence. No proxy is required - the portal is reachable from a plain datacenter IP.

Status-change and amendment detection reuse data already collected in the same page walk: `STATUS_CHANGE` compares the row's current `estado` against the last-seen value, and `UPDATED` compares a sha1 fingerprint computed over the row's own mutable fields (`nombreProceso`, `tipoProceso`, `fechaApertura`, `estado`, `unidadEjecutora`, `servicioAdministrativoFinanciero`, `monto`) - neither check costs an extra request. If a row's link markup is missing, or its detail postback fails after the retry policy above is exhausted, `source_url` falls back to the plain search page URL rather than dropping the record or leaving the field empty; `sourceUrlResolved: false` discloses that the value is a fallback, not a genuine permalink. Cross-run state (`onlyNew`'s seen-set of `numeroProceso` -> `{estado, hash}`) is persisted in a named key-value store, independent of any single run's own storage, capped at 2,000 entries with the current run's own discoveries kept first so they're never evicted by the cap.

## Pricing

Pay-per-event, two tiers, platform usage included:

| Event | Price | When |
| --- | --- | --- |
| `result` | $0.003 per record | `source_url` was genuinely resolved this run (default `resolveSourceUrl: true`) |
| `result-summary` | $0.001 per record | `resolveSourceUrl: false`, or the per-row postback failed or was missing |
| Actor start | $0.00005 | Once per run |

A daily monitor finding 5 changes with `resolveSourceUrl: true` costs about $0.02/day (~$0.45/month). A `resolveSourceUrl: false` monitor over a larger `maxItems` window is cheaper still and runs faster, at the cost of getting the generic search-page link instead of a process-specific permalink.

## Support & Enterprise SLA

This actor is built and maintained by an independent developer, not a staffed vendor team - there is no dedicated support desk or contractual uptime SLA on offer. Questions, bugs, or requests to expose more of the advanced search form's filters (date range, organism, process type) as actor input are handled through the Apify Store's Issues tab and are typically addressed within about 48 hours.
