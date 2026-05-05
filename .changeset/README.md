# Changesets

Releases for the app template are driven by [Changesets](https://github.com/changesets/changesets). The pattern:

1. Make a change
2. Run `bunx changeset` — pick the affected packages, choose `major`/`minor`/`patch`, write a one-liner. A markdown file lands in this directory
3. Commit the changeset with the change
4. On merge to `main`, a release PR is opened (or updated) by the Changesets GitHub Action — collecting all unreleased changesets into the next version
5. Merging the release PR cuts the version, updates `CHANGELOG.md` files, and tags

## What "version" means here

The customer-facing version is the **template** version, not individual `@app/*` packages. We pin `@app/web` and `@app/worker` together (`linked` in `config.json`). All other packages are private workspace deps — they bump as needed but don't ship anywhere.

Image tags published to GHCR follow the same SemVer + git SHA scheme — see `.github/workflows/build-images.yml`.

## When to bump

| Change | Bump |
|---|---|
| Security patch, dependency bump, log cleanup | `patch` |
| New feature, new env var, new optional config | `minor` |
| Breaking schema change, removed env var, changed default behaviour | `major` (and an ADR) |

Breaking changes need an entry in `CHANGELOG.md` describing the migration steps for customer admins. Customers reading release notes do their upgrades from these.
