# ADR 0024 — PDF processing library: pdfjs-dist + @napi-rs/canvas

**Status:** Accepted
**Date:** 2026-05-16

## Context

Sub-project B (PDF insert) needs the worker to do two things with an
uploaded PDF: extract its full text (for search) and render page 1 to a
PNG (a preview consumed by sub-project C). This requires a PDF parsing /
rendering library in the worker.

## Decision

Use **`pdfjs-dist`** (Mozilla PDF.js, Apache-2.0) for parsing and text
extraction, and **`@napi-rs/canvas`** (MIT) as the canvas backend that
rasterises page 1. Both are plain npm packages. `@napi-rs/canvas` ships
prebuilt platform binaries — including `linux-x64-musl` and
`linux-arm64-musl` — as `optionalDependencies`, so nothing is added to the
worker's Alpine Docker image and `bun install --ignore-scripts` is
unaffected.

## Consequences

- No system package is added to the curated worker Dockerfile.
- Both dependencies are permissively licensed — safe for a B2B template
  that customers fork commercially.
- `@napi-rs/canvas` is a prebuilt native module; the implementation plan
  verifies it loads and renders under Bun, and the worker Docker image
  build confirms the musl prebuilt resolves on Alpine.
- Rejected: **`poppler-utils`** — robust native CLI tools, but they would
  add a system package to the Dockerfile and an ops surface. Kept as the
  documented fallback if `@napi-rs/canvas` fails under Bun/Alpine.
- Rejected: **`mupdf`** — a single WASM library covering both needs, but
  AGPL-licensed, which is a concern for a commercially-forked template.

## References

- Spec: `docs/superpowers/specs/2026-05-16-pdf-insert-design.md`
- ADR 0023 — asset storage in Postgres
