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

## Phase 1 deliverables

1. **Scenario contract** in `benchmarks/scenarios/`
2. **Benchmark docs** in `benchmarks/README.md`
3. **Browser perf harness** for canonical routes ✅
4. **Server/load harness** for canonical routes ✅
5. **Veryfront vs Next.js comparison apps**
6. **Machine-readable result artifacts** ✅ + markdown summary

## Comparison policy

Phase 1 comparisons must:

- use the same scenario contract
- use the same host machine or container class
- use production mode only
- report both **cold** and **warm** request behavior where supported
- use the same warmup and run-count policy
- store raw outputs for review
- report framework deltas explicitly

## Planned command surface

These command names are the target command surface for the benchmark harness:

- `deno task bench:browser`
- `deno task bench:server`
- `deno task bench:compare:local`
- `deno task perf:bench`
- `deno task perf:autoresearch`
- `PLAYWRIGHT_PROJECT=production-host deno task bench:browser`
- `PLAYWRIGHT_PROJECT=preview-host deno task bench:browser`

Current implementation status:

- `deno task bench:browser` ✅ initial local browser harness
- `deno task bench:server` ✅ initial local server/load harness
- `deno task bench:compare:local` ✅ initial local comparison/report generator

The initial harness also accepts direct flags:

- `deno task bench:browser -- --framework veryfront --runtime preview-host --project blank`
- `deno task bench:browser -- --framework nextjs --runtime production-host --project blank`
- `deno task bench:server -- --framework veryfront --runtime production-host --requests 50 --concurrency 10`
- `deno task bench:browser -- --framework veryfront --runtime production-host --project blank --request-mode warm`
- `deno task bench:server -- --framework nextjs --runtime production-host --project blank --request-mode warm`
- `deno task bench:browser -- --framework veryfront --runtime production-host --project blank --request-mode cold --profiling`
- `deno task bench:compare:local -- --runtime production-host --project blank`

Warm request mode semantics:

- **cold**: measure the first request/navigation
- **warm**: issue one same-scenario warm-up request/navigation first, then
  measure the next request/navigation

Profiling semantics:

- benchmark request-phase profiling is **opt-in**
- pass `--profiling` on `bench:browser` or `bench:server` when you want
  per-phase `/_metrics` deltas for diagnosis
- keep profiling off for cleaner headline benchmark numbers

## Agent-facing performance loop

For iterative performance work, use the TypeScript/Deno autoresearch scripts
under `auto/`:

- `deno task perf:bench`
  - runs correctness gates, refreshes benchmarks, and writes a summary artifact
- `deno task perf:autoresearch -- --runs 3`
  - repeats the Veryfront benchmark lane, picks the best run, and prints
    parseable `METRIC ...` lines for agent iteration

See `auto/autoresearch.md` for the optimization contract and constraints.

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
