# Changelog

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
