# ADR 0012 — TLS via Caddy auto-ACME with manual override

**Status:** Accepted
**Date:** 2026-05-04

## Context

Customer environments range from open internet egress to fully air-gapped. TLS must work in both.

## Decision

Default Caddyfile uses automatic HTTPS via Let's Encrypt (ACME). For air-gapped or on-prem-cert customers, the Caddyfile template includes a commented `tls /path/to/cert.pem /path/to/key.pem` block they uncomment.

## Alternatives considered

- **Always manual certs** — friction on internet-connected customers
- **Always ACME** — broken on air-gapped sites
- **Two separate Caddyfile templates** — drift risk; one file with a documented switch is simpler

## Consequences

- Default install requires outbound 443 to ACME servers
- Operations doc covers both modes with a one-line switch
- Cert renewal in manual mode is the customer's responsibility — documented in `customer-install.md`

## References

- Spec §14 Q3, §13
