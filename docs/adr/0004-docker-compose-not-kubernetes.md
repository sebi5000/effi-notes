# ADR 0004 — Docker Compose as default deploy target (not Kubernetes)

**Status:** Accepted
**Date:** 2026-05-04

## Context

Customers operate the system on their own hardware. The deploy artifact must be operable by a generalist sysadmin without a Kubernetes background.

## Decision

Docker Compose v2 is the **only** supported deploy path in the template. Kubernetes manifests are **not** part of the template.

## Alternatives considered

- **Kubernetes (k3s/k8s)** — overkill for single-node single-tenant, large operational surface for the customer
- **Nomad / Podman Quadlets** — niche, less customer familiarity
- **Bare systemd units** — too manual

## Consequences

- A single-server setup is sufficient for most customers
- Vertical scale is the default, horizontal scale needs custom work per customer
- We avoid the operational complexity of HA control planes
- Customers with k8s preferences can author their own manifests from our images — out of scope for the template

## References

- Spec §4, §11
