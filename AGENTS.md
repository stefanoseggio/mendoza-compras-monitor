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
  Financiero, Monto), plus `linkTarget` - the row's own postback
  `__EVENTTARGET`, derived from its `<a id="...">` (added in the delta
  retrofit; see below for what it's for).
- `src/dateFilter.ts` - `parseFechaApertura`/`isWithinDateRange` for the
  `dateRange` input (added in the delta retrofit).
- `src/state.ts` - named key-value store persistence for `onlyNew` (added
  in the delta retrofit).
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

## HTTP transport: `impit`, not the native `fetch`

`src/fetchTenders.ts` makes requests via a module-level `Impit` instance
(`new Impit({ browser: 'chrome' })`, from the `impit` package), not the
global `fetch`. This gives every request a real, internally-consistent
Chrome TLS/HTTP2 fingerprint instead of Node's native one - added
2026-09-19 as part of the same fleet-wide TLS-fingerprint-hardening pass as
`florida-tenders-monitor` and `australia-grantconnect-monitor` (Node's own
`fetch` is not itself deprecated; this is proactive hardening, not a bug
fix). `requestWithRetry`'s return type is `ImpitResponse` (imported from
`impit`), not the DOM `Response`, and `extractCookieHeader`'s parameter was
loosened to the minimal structural type `{ headers: Headers }` it actually
reads - both needed real changes, not `as any`, once the return type
stopped being the native `Response`. Two things to know if you touch this
file again:
- **`Impit.fetch()` is a native binding, not built on the global `fetch`.**
  `vi.stubGlobal('fetch', ...)` will NOT intercept it - it does nothing and
  the real network call goes out, which is exactly what this migration
  found: the old `mockFetchSequence()` in `test/fetchTenders.test.ts` used
  `vi.stubGlobal('fetch', fetchMock)`, which would have silently stopped
  intercepting anything the moment the call site switched to
  `impit.fetch()`. Fixed by mocking the `impit` module itself instead
  (`vi.mock('impit', ...)`, with `vi.hoisted()` for the mock function
  reference, and a real `function` - not an arrow function - as the mock's
  `Impit` implementation, since `new Impit(...)` requires a constructible
  mock). Keep that pattern if `test/fetchTenders.test.ts` is extended.
- **`vi.mock('impit', ...)` is hoisted for the WHOLE file it's declared
  in** - it cannot be scoped to just one `describe` block the way
  `vi.stubGlobal`/`vi.unstubAllGlobals` could. This actor's live checks
  used to live in a `describe.skipIf(process.env.CI)` block at the bottom
  of `test/fetchTenders.test.ts` itself; once the `impit` mock was added to
  that file, the live tests silently got the mocked `Impit` too and every
  call resolved to `undefined` instead of a real response (verified live
  2026-09-19 - `TypeError: Cannot read properties of undefined (reading
  'ok')` on every live test, ~15s each from exhausting the retry/backoff
  loop against nothing). Fixed by moving the live checks to their own file,
  `test/live.test.ts` (matching the fleet convention already used by
  `florida-tenders-monitor`/`australia-grantconnect-monitor` for the same
  reason: separate test files get separate module registries, so
  `live.test.ts`'s `Impit` import is the real, unmocked package). Do not
  move live network checks back into a file that mocks `impit`.

## Delta engine v2 (2026-09-08)

Supersedes "record_id / event_type choices" below (kept as history - still
accurate about `record_id` and `scraped_at`, superseded on `event_type`).

**What changed:**

- `src/state.ts`: `DeltaState.entries` is now `Record<numeroProceso, {estado, hash}>`,
  not a bare `seenIds: string[]`. Both fields come from the grid row this
  actor already walks every run - free, no extra request. Not backward
  compatible with the v1 shape (see CHANGELOG.md).
- `src/fingerprint.ts` (new): sha1 over the grid row's mutable fields
  (nombreProceso, tipoProceso, fechaApertura, estado, unidadEjecutora,
  servicioAdministrativoFinanciero, monto).
- `event_type` is now NEW_LISTING / STATUS_CHANGE (estado differs from
  last time - e.g. "Pendiente Análisis" -> "Adjudicado", a real domain
  signal this source's own grid already carries) / UPDATED (same estado,
  fingerprint differs) / UNCHANGED (full-mode only), instead of a flat
  default. Both new classifications are free - no extra request - since
  `estado` and every fingerprinted field are already in the walked row.
- **No CLOSED event, considered and rejected**: unlike santafe/salta,
  this source has ~25,784+ total processes. A complete census (the only
  way CLOSED can be trusted - see salta-compras-monitor's AGENTS.md for
  why a partial walk can't prove absence) would mean thousands of
  sequential postbacks - hours, not seconds. Building CLOSED here would
  mean either lying about completeness on a normal `maxItems`-bounded run,
  or making a "cheap" delta run silently balloon into an hours-long crawl
  the moment `onlyNew` is combined with a naive full-census requirement.
  Neither is acceptable, so this event is simply not offered for Mendoza.
- **New `resolveSourceUrl` input** (default true): the existing per-row
  detail postback (~1.5s/row, see "source_url requires one extra request"
  below) is now optional. Disabling it gives a much faster large-`maxItems`
  run at the cost of `source_url` falling back to the generic search page
  for every record - the same degraded-fallback value the code already
  used for a failed/missing link, now selectable on purpose. Tracked per
  record via the new `sourceUrlResolved` output field.
- **Pricing**: two-tier PPE - `result` $0.003 (source_url genuinely
  resolved this run) / `result-summary` $0.001 (resolveSourceUrl=false, or
  the postback failed/was missing - same fallback path, same price).
  `Actor.pushData(record, eventName)` performs the charge itself (verified
  against the installed SDK's `.d.ts` before writing this, per the
  double-charge bug caught on salta-compras-monitor during the same pass)
  - no separate `Actor.charge()` call.
- `eventTypes` input narrows delta-mode delivery, matching the fleet
  convention on santafe/tucuman/salta.

## Delta engine (2026-09-06 retrofit)

Added `onlyNew`/`dateRange` input + the standardized B2B output envelope
(`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`) used
across this portfolio's fleet (see `uk-hse-enforcement-monitor` for the
contract's origin). Mendoza-specific implementation notes:

### Ordering was checked live BEFORE writing any early-stop code, and it failed the check

The delta-engine spec requires verifying the listing is genuinely,
reliably sorted newest-first before implementing page-level early-stop for
`onlyNew`. It is not. Live evidence (both real fixtures, `test/fixtures/page1.html`
and `page2.html`, plus a fresh live re-check 2026-09-06):

```
10201-0001-CDI20 | 16/03/2020 10:00 Hrs.
10201-0001-CDI21 | 16/03/2021 10:00 Hrs.
10201-0001-CDI22 | 02/03/2022 10:00 Hrs.
10201-0001-CDI23 | 10/03/2023 10:00 Hrs.
10201-0001-CDI24 | 14/02/2024 09:00 Hrs.
10201-0001-CDI25 | 13/03/2025 10:00 Hrs.
10201-0001-CDI26 | 18/05/2026 10:00 Hrs.
10201-0001-LPU19 | 29/10/2019 10:00 Hrs.
10201-0001-LPU20 | 27/03/2020 10:00 Hrs.
10201-0001-LPU21 | 24/02/2021 11:00 Hrs.
```

This is **page 1** of a blank-form search - the exact query the actor has
always run. It is sorted by `numeroProceso` **ascending** (each
organism/type's own sequential counter, `NNNNN-NNNN-<TIPO><YY>`, cycling
through years 2019-2026 within a handful of rows) - not by date, and
nowhere close to newest-first. A brand-new process created today sorts
wherever its own organism's next counter value lands, which could be page
1 or page 2,578 depending entirely on that organism's history - not
predictable, and never concentrated near the front. The existing
`firstId === previousFirstId` stall-guard (a defensive measure against the
site repeating a page boundary) is unrelated to this - it's a **guard**
against a specific pagination glitch, not evidence either way about sort
order; the sort-order finding above is separate and comes straight from
parsed row content, not from stall-guard behavior.

**Decision: `onlyNew` is implemented as a safe post-filter, not
early-stop**, per the spec's own explicit fallback for this exact
situation. `fetchTenders()` still walks up to `maxItems` raw rows exactly
as before (same pagination, same stall-guard, same safety cap - all
untouched), and only AFTER a row is walked does it check `seenIds`/
`dateRange` to decide whether to keep it. This means:

- A delta run does **not** resolve faster than a normal run of the same
  `maxItems` (unlike HSE's early-stop, which turns a delta run into a
  handful of requests). The only thing `onlyNew` saves here is the
  `source_url` resolution cost (see below) for rows it filters out.
- A delta run does **not** guarantee it will find whatever is genuinely
  new since last time - if the newly created processes' `numeroProceso`
  values don't fall within the first `maxItems` raw rows in ascending
  sort order, they simply won't be walked this run. This is disclosed
  plainly in `README.md` and the input schema, not hidden behind a
  green checkmark.
- This is a real, load-bearing limitation of the _source_, not a
  half-finished implementation - a correct post-filter that admits its
  own weak recall beats a fake early-stop that would either never
  trigger (walking the whole backlog every time, since page 1 is
  never "fully known and about to become new" the way a newest-first
  register's tail is) or trigger immediately and wrongly (mistaking "page
  1 is old" for "everything is old").

### `source_url` requires one extra request per returned record - this is new architecture, not a copy of HSE's free link

Unlike HSE's listings (plain `<a href="...">` per row, zero extra cost),
Mendoza's grid links are `javascript:__doPostBack('...lnkNumeroProceso','')`

- there is no plain href, no per-row id in any hidden field, nothing to
  construct a permalink from without asking the server. Verified live
  2026-09-06 by replaying a row's own postback:

- The server redirects to `PLIEGO/VistaPreviaPliegoCiudadano.aspx?qs=<opaque token>`
    - a standalone, **cookie-independent** public page. Confirmed by fetching
      that exact URL fresh, with zero cookies at all: it returns HTTP 200 and
      the correct process's own content (`numeroProceso` and `nombreProceso`
      both present in the body). This is a genuine, stable, shareable
      permalink - not a session-bound dead end.
- The SAME page's ViewState (i.e., the `$` already loaded from parsing a
  given page's grid) can be replayed for **any** row on that page, in
  **any** order, and doing so does **not** disturb that page's own further
  pagination - verified live by resolving 4 different rows' links from one
  page's ViewState, then successfully continuing to `Page$2` from that
  same, unmodified ViewState afterward. This is why `resolveSourceUrl()`
  is called inline, per surviving row, right after `parseGrid()` on that
  page - no need to retain every page's ViewState in memory for a later
  pass.
- **Real cost, measured live**: ~1.5s per detail postback (4 requests took
  6.0s). A default `maxItems=100` run with `onlyNew=false` (i.e. every
  walked row survives) now makes roughly 10 pagination requests + 100
  detail requests instead of 10 total - a real, order-of-magnitude
  increase in request count and wall-clock time (a few minutes instead of
  seconds), fully disclosed in `README.md`'s Known Limitations rather than
  silently shipped. `onlyNew=true` mitigates this automatically as a side
  effect: rows filtered out by the seen-set never get a detail request
  (see the "safe post-filter" section above and the matching test), so a
  warm delta run pays this cost only for genuinely-kept rows.
- If a row's link markup is missing, or the detail postback fails after
  the existing 4-retry/exponential-backoff policy, `source_url` falls back
  to the plain search page URL (`BuscarAvanzado2.aspx`) rather than
  dropping the record or leaving the field empty - a degraded but still
  real, non-empty value. Disclosed, not silently swallowed.
- The detail postback's own `Set-Cookie` response is deliberately **not**
  merged back into the main session cookie jar used for pagination - it's
  a read-only side channel, isolated from the primary flow's state, to
  avoid any risk of it perturbing the next `Page$N` postback.

### `record_id` / `event_type` choices

- `record_id` = `numeroProceso` verbatim (already the domain's real unique
  id, e.g. `10201-0001-CDI20`) - not hashed, not reformatted.
- `event_type` = `'NEW_LISTING'` for every process, unconditionally.
  Mendoza has one homogeneous register (unlike HSE's convictions/notices
  split, which justified `SANCTION` vs `NEW_LISTING`) - a procurement
  process is not itself a sanction or a specific outcome, it's a listing
  appearing in the public register, whatever its `tipoProceso` or
  `estado`. Those two fields already carry the real domain distinction;
  duplicating that into `event_type` would be noise, not signal.
- `scraped_at` is computed **once** per run (in `fetchTenders()`, passed
  down as `options.now`) and applied to every record from that run - fixed
  from the pre-retrofit code, which computed `new Date().toISOString()`
  inside `parseGrid()` and so gave every page a very-slightly-different
  timestamp, violating the envelope's "same value for every record from
  one run" requirement. No test caught this before because no test
  asserted cross-page timestamp equality; not a behavior anyone was
  relying on.

### `dateRange` needed a real fix, not a copy-paste of HSE's formula

HSE's `isWithinDateRange` is `now - date <= window`, which is correct for
Offence Date because that field is always in the past. Mendoza's
`fechaApertura` ("Fecha de apertura") is the process's **scheduled
bid-opening date** and is routinely a **future** date relative to
publication - a currently open tender's opening date hasn't happened yet
by definition. Copy-pasting HSE's formula verbatim would have been a real
bug: for a future date, `now - date` is negative, and a negative number is
always `<= window`, so every future-dated process would silently match
every `dateRange` preset regardless of how far out it is. Fixed in
`src/dateFilter.ts` by requiring `diff >= 0` as well - a date only counts
as "within range" if it has actually already happened. Covered by a
dedicated test (`test/dateFilter.test.ts`, "excludes a future-dated
process even though it is close to now").

### State

`src/state.ts` opens a **named** key-value store
(`mendoza-compras-monitor-delta-state`), not the run's default one (which
is isolated per run and would not survive between scheduled runs). Mendoza
has a single, homogeneous process listing - unlike HSE's convictions/
notices split - so state uses the flat `{ seenIds: string[], lastRunAt }`
shape the spec describes as the default, no per-dataset keying needed.
Capped at 2000 ids, current run's own discoveries kept first so they're
never evicted by the cap (same merge order as HSE's `state.ts`).

### Local testing gotcha carried over from HSE

Same as HSE: `apify run` purges local storage by default, even without
`--purge` explicitly passed. Use `--no-purge` to test delta behavior
across two separate local runs, or the second run sees an empty seen-set
and rediscovers everything as "new". The named state store itself is not
touched by default purging either way (only the run's own default
request-queue/dataset/KV store are) - not verified again here
independently since HSE already confirmed it and the mechanism (a
DIFFERENT, explicitly-named store) is identical.

## Timeout budget (2026-09-19 fix)

**Confirmed bug**: this actor's live `defaultRunOptions.timeoutSecs` is **600s**
(verified via `GET /v2/acts/stefano_Seggio~mendoza-compras-monitor`), but two
things were true before this fix:

1. `maxItems` had `minimum: 1` and no `maximum` in `.actor/input_schema.json` -
   nothing related the size of a raw walk to the real 600s budget.
2. `fetchTenders()` returned one big `tenders` array only after the *entire*
   walk finished, and `main.ts` pushed all of it to the dataset in a loop
   afterward - so a run killed by the platform timeout mid-walk lost every
   record gathered so far, not just the ones still to come.

**Real arithmetic** (constants read from the actual code, not estimated):

- `resolveSourceUrl`'s per-row postback costs **~1.5s/row**, measured live
  (see "source_url requires one extra request per returned record" above:
  "4 requests took 6.0s"). This is the dominant, documented cost that scales
  with `maxItems` when `resolveSourceUrl=true` (the default).
- Happy-path (zero retries) time for a full walk: `T(maxItems) = maxItems x 1.5s`.
  Since `maxItems` had no ceiling, `T` was unbounded - e.g. `maxItems=500` ->
  `750s`, already past the 600s timeout with a perfectly healthy network and
  zero errors. This alone reproduces the confirmed finding.
- Sizing a cap at 70% of the real budget (600 x 0.7 = 420s) against the real
  1.5s/row cost: `420 / 1.5 = 280`. **`maxItems.maximum` is now `280`.**
- Retry-storm check, using the real retry constants in `requestWithRetry`
  (`maxRetries=4`, `baseDelayMs=1000`, backoff `1000 * 2^attempt`): a single
  row that exhausts all 4 retries burns `1000*(1+2+4+8)=15000ms` of pure
  backoff delay alone, before any actual request time. If *every* row in a
  280-item walk needed this, that's `280*15s=4200s` - far past 600s. This
  scenario is real but self-limiting in practice: the home-page GET and the
  two initial POSTs that establish the session are **not** wrapped in a
  try/catch, so a network bad enough to make every row's postback exhaust
  its retries would very likely already fail those un-degraded early
  requests first, throwing and producing a clean early error record via
  `main.ts`'s catch block - not a silent multi-hundred-row death march. The
  input-schema cap above is sized against the documented, common
  (healthy-network) cost, not this pathological tail.
- Because that pathological tail is real even if rare, the more valuable fix
  is architectural, not numeric: `fetchTenders()` now takes an `onTender`
  callback invoked immediately when each record qualifies (`main.ts` pushes
  it to the dataset right there, and returns `{ stop: true }` on
  `eventChargeLimitReached` to halt the walk immediately instead of only
  suppressing further pushes after an already-finished walk), and an
  `onCheckpoint` callback invoked after every completed page with the
  running `observedThisRun` snapshot, so the delta-state seen-set is also
  saved incrementally. A run that still hits the 600s timeout - at any
  `maxItems` value, for any reason - now loses only its unprocessed tail,
  not everything gathered before the timeout.
- `defaultRunOptions.timeoutSecs` itself was deliberately left at 600s: the
  real problem was an uncapped input (option a) and end-of-walk-only
  pushing (option c), not a workload that legitimately needs to run longer
  than 600s at its now-capped maximum (280 rows x 1.5s = 420s, well under
  600s) - raising the timeout instead would have papered over the same bug
  at a larger, more expensive scale.

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
  bulk-export path worth investigating in a future session). Since the
  2026-09-06 delta retrofit this is even more true: each returned record
  now costs one _additional_ sequential request to resolve `source_url`
  (see "Delta engine" above), so a default 100-item run is now ~110
  requests, not ~10 - raise `maxItems` with that in mind.
- `event_type` does not diff field-level changes to a previously-seen
  process (e.g. `estado` moving from "Pendiente Análisis" to
  "Adjudicado") - only "did this id exist in the seen-set before this
  run" is tracked. Full snapshot storage + diffing would be needed for
  real field-level change detection; deferred, disclosed in README.
- `monto` is kept as a raw string (Argentine number format, comma
  decimal, e.g. "1869000,00") rather than parsed to a number, matching
  this portfolio's established convention of not silently reformatting
  source financial values.
