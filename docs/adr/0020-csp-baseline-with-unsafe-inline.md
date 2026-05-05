# ADR 0020 — CSP baseline with `'unsafe-inline'` for script/style

**Status:** Accepted
**Date:** 2026-05-05

## Context

Next.js App Router (16) emits inline RSC payload `<script>` tags whose contents are dynamic per-request. A strict CSP without `'unsafe-inline'` requires per-request nonces, which means a Next.js middleware that:

1. Generates a per-request nonce
2. Sets `Content-Security-Policy: ... 'nonce-<value>' ...` on the response
3. Passes the nonce into the RSC framework so emitted `<script>` tags include `nonce="<value>"`

This is doable but adds enough machinery (middleware, RSC plumbing) that a "first-step" template ships fragile if it claims nonce-CSP without battle-testing.

## Decision

The template ships a baseline CSP with:

- `script-src 'self' 'unsafe-inline'`
- `style-src 'self' 'unsafe-inline'`

Plus full `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `default-src 'self'`. This is a real defence-in-depth layer (no XSS, no clickjacking via frames, no third-party origin loading), just not the strictest possible.

## Alternatives considered

- **Strict CSP with nonces from day one** — rejected for now: doubles the surface area of the template, requires careful Next-version-specific wiring that drifts. Customer projects with audit needs upgrade
- **No CSP** — rejected: ships a major security regression vs. the rest of the headers (HSTS, X-Frame-Options, etc.)

## Consequences

**Positive**
- Works out of the box across Next.js versions
- Still blocks third-party origin script/style/iframe loading
- Documented escape hatch: customer projects swap in nonce-based CSP via Next middleware (~30 LOC pattern)

**Negative / risks**
- A real XSS defect in customer code can run inline scripts. The other layers (input validation in Zod, Next's auto-escaping in JSX) are the primary defence; CSP `'unsafe-inline'` removes the last-mile fence

## Customer upgrade path

1. Add middleware that generates a per-request nonce (`crypto.randomBytes(16).toString('base64')`)
2. Set the nonce on `request.headers` so RSC can pick it up
3. Replace the CSP in `deploy/caddy/snippets/security-headers.caddy` with `'nonce-{Header.x-csp-nonce}'`-templated values, or move CSP emission into Next so the nonce travels with the response
4. Test in staging — broken inline `<script>` tags surface as console errors

## References

- CSP spec: <https://www.w3.org/TR/CSP3/>
- Next.js CSP guide: <https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy>
- ADR 0007 — Caddy as reverse proxy
