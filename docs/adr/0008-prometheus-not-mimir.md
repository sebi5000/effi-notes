# ADR 0008 — Prometheus as metrics backend (not Mimir)

**Status:** Accepted
**Date:** 2026-05-04

## Context

The observability stack needs a metrics backend that integrates with OTel Collector and Grafana.

## Decision

Prometheus single-binary with local TSDB.

## Alternatives considered

- **Grafana Mimir** — multi-tenant, scale-out, object storage; designed for centralized observability platforms — not for single-tenant on-prem
- **VictoriaMetrics** — competitive single-binary alternative, smaller community than Prometheus, less likely to be familiar to customer ops

## Consequences

- Operating model is a single container with a volume — minimal cognitive load
- Retention is bounded by local disk; sufficient for single-instance dashboards
- Cross-customer aggregation (if we ever want it) happens via OTLP push to **our** infrastructure — orthogonal to this choice

## References

- Spec §2, §7
