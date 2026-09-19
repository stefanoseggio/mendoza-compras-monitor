# Changelog

## [3.0.0](https://github.com/stefanoseggio/mendoza-compras-monitor/compare/mendoza-compras-monitor-v2.0.1...mendoza-compras-monitor-v3.0.0) (2026-09-19)


### ⚠ BREAKING CHANGES

* v2.0 delta engine - STATUS_CHANGE/UPDATED for free, optional source_url resolution

### Features

* delta engine (onlyNew/dateRange) + standardized B2B output envelope ([5d67cfe](https://github.com/stefanoseggio/mendoza-compras-monitor/commit/5d67cfea1e8dc9d96b73000b0fda4763326ffd9b))
* Mendoza Compras Monitor - COMPR.AR classic GridView, direct page jumps ([060cdf6](https://github.com/stefanoseggio/mendoza-compras-monitor/commit/060cdf6936e77cd77962402c46c0d7dbc4b355f4))
* v2.0 delta engine - STATUS_CHANGE/UPDATED for free, optional source_url resolution ([8871bd1](https://github.com/stefanoseggio/mendoza-compras-monitor/commit/8871bd1ffa4f64cb1f95a9848b9b838a07a323e8))


### Bug Fixes

* cap maxItems and push data incrementally so a 600s timeout can't drop everything ([#9](https://github.com/stefanoseggio/mendoza-compras-monitor/issues/9)) ([6b10a4b](https://github.com/stefanoseggio/mendoza-compras-monitor/commit/6b10a4bda439ecdddede82ef46566ec2cdd55f64))
* **ci:** pass RELEASE_PLEASE_TOKEN so release PRs skip the bot-approval gate ([cee8842](https://github.com/stefanoseggio/mendoza-compras-monitor/commit/cee8842a7cfea643ba12e183086e38b99bddd8e1))

## 2.0.1 - 2026-09-14

### Fixed

- **Default `maxItems` lowered from 100 to 20**: a blank/default run (as used by Apify's automated Actor quality test) was timing out at the platform's 5-minute limit. Root cause confirmed from a real timed-out run's log: page 1 completed in ~34s, then the run made no further progress for 4+ minutes before being killed. With `resolveSourceUrl` defaulting to `true` (one sequential per-row postback, ~1.5s each, see its own input description), a 100-item raw walk (10 pages) spends on the order of 150s+ just resolving permalinks, on top of per-page fetch latency against this site's real response times - comfortably over budget. 20 items (2 pages) finishes in well under a minute with the same defaults; real monitoring runs should raise `maxItems` explicitly.

## 2.0.0 - 2026-09-08

The v2 delta engine: status-change and amendment detection, replacing the v1 retrofit's "always NEW_LISTING" limitation - see AGENTS.md "Delta engine v2" for the full technical reasoning.

### Added

- **`STATUS_CHANGE` events**: a process whose `estado` changed since it was last seen (e.g. "Pendiente Análisis" -> "Adjudicado") is now reported as `STATUS_CHANGE` - free to detect, `estado` is already in the walked grid row.
- **`UPDATED` events**: a process whose content changed (monto, fecha, unidad ejecutora, any other field) while keeping the same estado is detected via a sha1 content fingerprint (`contentHash`).
- **`eventTypes` input**: narrows delta-mode delivery to a subset of `NEW_LISTING`/`STATUS_CHANGE`/`UPDATED`.
- **`resolveSourceUrl` input** (default true): the per-row detail postback that resolves a process-specific permalink (~1.5s/row) is now optional - disable it for a much faster large-`maxItems` run. Tracked via the new `sourceUrlResolved` output field.
- `contentHash` output field; a second dataset view ("Status changes & amendments").
- Apache-2.0 `LICENSE`, this `CHANGELOG.md`, an `npx eslint .` step in CI.

### Changed

- **Delta state shape**: `src/state.ts` replaced the v1 bare `seenIds: string[]` with `entries: Record<numeroProceso, {estado, hash}>` - needed for both STATUS_CHANGE and UPDATED. **Not backward compatible**: a v1-shaped state is treated as absent, not migrated - an existing scheduled task's next run re-baselines.
- Pricing: two-tier PPE (`result` $0.003 when source_url is genuinely resolved / `result-summary` $0.001 when it falls back to the generic search page), replacing the v1 flat single-tier price.
- **Considered and explicitly rejected**: a `CLOSED` event (a previously-seen process no longer in the register), unlike sibling actors on much smaller registers (santafe, salta). At ~25,784+ total processes, only a complete census can trust "absent = closed", and that census would take thousands of sequential postbacks - hours, not seconds. Not built here; see AGENTS.md.

### Fixed

- Production `start` script pointed at `start:dev` (`tsx`), which Apify's production image cannot run (`npm install --only=prod` strips `tsx`). Switched to the prebuilt `dist/main.js` and stopped gitignoring `dist/` so the build actually ships.
