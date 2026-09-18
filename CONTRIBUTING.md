# Contributing

This repository ships the real, buildable TypeScript source for the **Mendoza COMPR.AR Argentina - Tender Delta API** Apify Actor. It is independently maintained by Stefano Seggio as part of the [Delta Registry](https://github.com/stefanoseggio) fleet — there is no separate contributor team, but external bug reports, source-coverage proposals, and documentation fixes are welcome.

## Local setup

```bash
git clone https://github.com/stefanoseggio/mendoza-compras-monitor.git
cd mendoza-compras-monitor
npm install
apify login          # once per machine, needed only for `apify run`
```

No third-party credentials are required — this Actor needs nothing beyond your Apify account; there is no BYOK requirement and no separate `comprar.mendoza.gov.ar` credential involved. No proxy is required either; the portal is reachable from a plain datacenter IP.

## Development workflow

```bash
npm run start:dev     # tsx src/main.ts
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write .
npm run build          # tsc
npm test               # vitest run
```

Local runs hit the real, live `comprar.mendoza.gov.ar` portal — there is no bundled fixture/mock server for `start:dev`. Use a small `maxItems` while developing to keep runs fast and avoid unnecessary load on the source portal.

## Branch naming

- `fix/<short-description>` — bug fixes
- `feat/<short-description>` — new input fields, new output fields, new source coverage
- `docs/<short-description>` — README/documentation-only changes
- `chore/<short-description>` — dependency bumps, tooling, CI changes

## Commit convention

This repository follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>
```

Types used here: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`. The `type` prefix drives automated changelog generation via `release-please` (see [`.github/workflows/release.yml`](.github/workflows/release.yml)) — a `feat:` commit triggers a minor version bump, `fix:` triggers a patch bump, and `feat!:`/a `BREAKING CHANGE:` footer triggers a major bump. Non-conventional commit messages are still accepted but won't be reflected in the auto-generated changelog entry for that change.

## Pull requests

1. Fork or branch, make your change, and ensure `npm run lint`, `npm run build`, and `npm test` all pass locally.
2. Open a PR against `main` using the repository's [PR template](.github/PULL_REQUEST_TEMPLATE.md).
3. CI (`.github/workflows/test.yaml`) runs automatically and must pass before merge.
4. Behavioral changes to the Actor's input/output schema should also update `.actor/input_schema.json` / `.actor/dataset_schema.json` and the corresponding README sections in the same PR — schema and documentation drift is treated as a real bug, not a follow-up.

## Questions or non-code issues

For questions that aren't a code change (pricing, licensing, enterprise inquiries), use the Apify Store's Issues tab on the [live Actor page](https://apify.com/stefano_seggio/mendoza-compras-monitor) rather than a GitHub issue.
