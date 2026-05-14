# Performance Testing

This document defines the phase-1 performance-testing strategy for comparing
**Veryfront** against peer frameworks such as **Next.js**.

## Goals

Phase 1 is **local-first** and focuses on fair, repeatable comparisons on the
same machine/container.

We want to answer two questions:

1. **Browser UX performance** — how fast does a Veryfront app feel?
2. **Framework/server performance** — how efficiently does Veryfront serve and
   render the same workload compared with other frameworks?

## Principles

- **Compare like-for-like workloads only.**
- **Use production builds** for all benchmarked frameworks.
- **Keep the benchmark contract versioned** in this repo.
- **Separate correctness testing from performance testing.**
- **Treat local comparison as the source of truth** before adding deployed runs.

## Primary Metrics

### Browser / UX metrics

The baseline browser metric set is:

- **TTFB** — response start / network+server loading signal
- **FCP** — first contentful paint
- **LCP** — largest contentful paint
- **INP** — interaction to next paint
- **CLS** — cumulative layout shift
- **TBT** — total blocking time (lab interactivity proxy)

Notes:

- We treat **INP** as the primary user-facing interactivity metric.
- We keep **TBT** because it is still useful in local lab runs.
- We may record **TTI** if a tool emits it, but it is not a primary gate.

### Server / framework metrics

The baseline server metric set is:

- **p50 / p95 / p99 latency**
- **throughput / requests per second**
- **error rate under load**
- **steady-state memory**
- **CPU usage**
- **SSR render duration**
- **RSC stream duration** where applicable
- **response size / transferred bytes**

## Recommended Tooling

### Browser

- **Lighthouse CI** — repeatable local lab audits and regression gates
- **k6 browser** — browser metrics + thresholds + scripted journeys
- **WebPageTest** — optional later for deployed/network-sensitive validation

### Server

- **autocannon** — HTTP throughput/latency benchmarking
- **k6** — optional if we want one tool for both browser + HTTP scenarios
- Repo-native observability endpoints for internal timing and resource signals

## Existing repo capabilities

The current codebase already provides useful foundations:

- Playwright browser E2E lanes in `tests/e2e/*.playwright.ts`
- runtime lanes: `production-host` and `preview-host`
- a Playwright task in `deno.json`
- local metrics endpoint: `/_metrics`
- dev metrics endpoint: `/_dev/api/metrics`
- concurrency/stress examples in integration tests
- a `Deno.bench` example for micro-benchmark style work

These are a starting point, not a complete performance harness.

## Benchmark harness

The benchmark harness, scenario contracts, comparison apps, and command
surface live in a separate repository:
[**veryfront/veryfront-benchmarks**](https://github.com/veryfront/veryfront-benchmarks).

That repo owns:

- the scenario contract and canonical scenarios
- the browser and server/load harnesses
- the Veryfront vs Next.js comparison apps
- the comparison policy and machine-readable result format
- the agent-facing perf loop scripts

This repo retains the **strategy, principles, and metric definitions** above
so the core codebase can document what we measure and why without coupling
to the harness implementation.

## Out of scope for phase 1

- public marketing benchmark claims
- large framework matrix beyond Veryfront vs Next.js
- multi-region or CDN edge benchmarking
- synthetic tuning of benchmark apps that drifts from realistic usage

## Next phases

### Phase 2

- deployed validation
- WebPageTest runs with throttling/network variance
- replace the lightweight server runner with an `autocannon`/k6-backed lane
- optional additional frameworks (Remix, Astro, others)

### Phase 3

- nightly historical tracking
- dashboarding and trend alerts
- stronger CI regression budgets
