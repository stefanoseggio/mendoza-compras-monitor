# AGENTS.md - Mendoza Compras Monitor

Technical notes for whoever (human or AI) touches this actor next.

## What this actor does

Extracts public procurement processes (licitaciones, contrataciones
directas) from the Province of Mendoza, Argentina's COMPR.AR-based portal
(`comprar.mendoza.gov.ar`), with type, status, organism and budget per
process.

## Why this target was treated as high-risk, and what was actually found

Mendoza runs COMPR.AR - the same national platform whose original
candidate site was killed early in this project's portfolio for being
wrapped in DevExpress `ASPxGridView`/`ASPxCallback` controls requiring a
real browser. Verified live before writing any code (2026-09-04):

- The homepage and `BuscarAvanzado2.aspx` genuinely DO have real
  DevExpress controls (`ASPxDateEdit` calendar widgets, `ASPxCallback`,
  multiple `UpdatePanel`, a `ScriptManager`) - but confirmed, by grepping
  the actual results-grid markup specifically, that they are confined to
  peripheral filter UI (the date picker, a supplier-search modal). The
  results grid itself, `id="ctl00_CPH1_GridListaPliegos"`, is a classic
  ASP.NET `GridView` (plain `<thead>`/`<tbody>`, not `ASPxGridView`).
- Pagination is the standard, well-documented ASP.NET GridView mechanism:
  `__EVENTTARGET=ctl00$CPH1$GridListaPliegos`,
  `__EVENTARGUMENT=Page$N`. Verified live that the server accepts ANY
  page number directly - jumped straight from page 1 to page 50 with no
  intermediate requests and got correct, different data back. This is
  simpler than `cordoba-compras-monitor`'s bespoke sliding-11-slot-window
  pager, which required walking through empty "next block" slots and
  discovering a bare `paglbS` control - nothing like that exists or is
  needed here.
- `__EVENTVALIDATION` is genuinely absent from every response in this
  flow (0 occurrences across both captured fixtures) - unlike Cordoba,
  where omitting it caused a "Validation of viewstate MAC failed" error.
  Confirmed harmless live: pagination postbacks succeed without it. This
  page has event validation disabled; do not assume it's needed just
  because a sibling actor needed it.
- Charset: server declares and serves real UTF-8 throughout (verified at
  the byte level) - no special decoding needed, unlike
  `tucuman-compras-monitor` (ISO-8859-1) or `entrerios-compras-monitor`
  (Windows-1252 despite a UTF-8 declaration).
- No proxy needed - reachable directly from a plain datacenter IP.

## Architecture

- `src/parsers/form.ts` - same `extractFormFields`/`buildPostbackPayload`
  pattern as `cordoba-compras-monitor`: replicate exactly what a real
  browser submits (every non-button input's value, every select's chosen
  option, only checked checkboxes/radios).
- `src/parsers/grid.ts` - `parseGrid($)` reads
  `table#ctl00_CPH1_GridListaPliegos > tbody > tr`, 8 columns matching the
  header exactly (Numero proceso, Nombre proceso, Tipo de Proceso, Fecha
  de apertura, Estado, Unidad Ejecutora, Servicio Administrativo
  Financiero, Monto).
- `src/fetchTenders.ts` - drives the full session: GET home -> POST the
  home page's "Busqueda de Procesos" postback
  (`ctl00$CPH1$CtrlBusquedasHome$btnBusquedaProcesos`) to land on
  `BuscarAvanzado2.aspx` -> POST the "Buscar" button
  (`ctl00$CPH1$btnListarPliegoAvanzado`) for page 1 -> loop POSTing
  `Page$N` for N=2,3,... directly (no pager-window bookkeeping needed,
  unlike Cordoba). Cookies (`ASP.NET_SessionId` plus a second opaque `_`
  cookie the server also sets) are captured via `response.headers.getSetCookie()`
  and forwarded on every request - both are required for the session to
  stay valid across the sequence.
- Dedup by `numeroProceso` as a defensive measure (same pattern as
  Cordoba's live-data-drift fix and Salta's overlapping-pagination fix),
  though no actual overlap between pages was observed during testing -
  kept in as cheap insurance given the two other stateful-postback actors
  in this portfolio both needed it for real.

## Known scope limits (disclosed, not hidden)

- The unfiltered backlog is huge: **25,784 processes** at audit time (10
  per page = ~2,579 pages). This actor does not yet expose the advanced
  search form's filters (date range, organism, process type, keyword) as
  actor input - their exact field names and valid values were not
  live-verified before v1 shipped (the search was run with an entirely
  blank form, which is confirmed live to return the full unfiltered set).
  Adding filters is a natural v2 - a future session should verify each
  filter parameter live before exposing it, same discipline as always.
- `maxItems` defaults to 100 specifically because of the above - raising
  it a lot means many genuinely sequential POST requests (no bulk/API
  shortcut was found; the "Descargar Reporte Excel" button seen on the
  results page was not explored as an alternative - it may be a faster
  bulk-export path worth investigating in a future session).
- `monto` is kept as a raw string (Argentine number format, comma
  decimal, e.g. "1869000,00") rather than parsed to a number, matching
  this portfolio's established convention of not silently reformatting
  source financial values.
