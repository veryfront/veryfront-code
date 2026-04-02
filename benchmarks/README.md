# Benchmarks

This directory contains the benchmark contract and, later, the executable
benchmark harness used to compare **Veryfront** against peer frameworks.

## Purpose

The benchmark system should answer:

- how fast Veryfront serves and renders representative routes
- how browser-visible metrics compare against a matched Next.js app
- whether regressions are visible in local, repeatable benchmark runs

## Structure

```text
benchmarks/
├── README.md
├── scenarios/
│   ├── README.md
│   └── canonical-scenarios.json
├── apps/
│   ├── veryfront/         # manifest + repo-root harness notes
│   └── nextjs/            # manifest scaffold for future comparison app
├── browser/               # implemented initial local runner
├── server/                # implemented initial local runner
├── results/               # generated run artifacts
├── compare/               # local comparison/report scripts
└── report/                # generated comparison artifacts
```

## Benchmark contract

Everything should flow from `scenarios/canonical-scenarios.json`.

That contract defines:

- the scenarios
- their workload shape
- which metrics are primary
- which routes must exist in each framework app
- which comparisons are allowed

If a framework app cannot represent a scenario faithfully, the scenario should
be marked accordingly instead of forcing an unfair comparison.

## Canonical scenarios

Phase 1 uses four scenarios:

1. `static_route`
2. `ssr_data_route`
3. `interactive_hydrated_route`
4. `api_route`

See `scenarios/README.md` and `scenarios/canonical-scenarios.json`.

## Output requirements

Each benchmark run should emit:

- raw machine-readable output (JSON)
- normalized comparison output (JSON or CSV)
- human-readable markdown summary

At minimum, reports should include:

- scenario name
- framework name
- metric name
- value
- unit
- run metadata (timestamp, runtime, machine/environment tag)

## Fairness rules

All comparisons should follow these rules:

- production builds only
- same host machine/container
- same route/data semantics
- same warmup policy
- same sample count or iteration count
- same browser/runtime version where feasible
- raw artifacts retained for review

## Planned benchmark lanes

### Browser lane

Current implementation:

- `deno task bench:browser`
- Playwright-driven local browser run against the canonical routes
- optional flags: `--framework <veryfront|nextjs> --runtime <production-host|preview-host> --project <slug> --request-mode <cold|warm>`
- optional diagnostic flag: `--profiling`

Planned upgrades:

- Lighthouse CI
- k6 browser

Primary outputs:

- TTFB
- FCP
- LCP
- INP
- CLS
- TBT

### Server lane

Current implementation:

- `deno task bench:server`
- lightweight fetch-based concurrent load runner
- optional flags: `--framework <veryfront|nextjs> --runtime <production-host|preview-host> --project <slug> --requests <n> --concurrency <n> --request-mode <cold|warm>`
- optional diagnostic flag: `--profiling`

Planned upgrades:

- autocannon
- optional k6 HTTP
- repo metrics endpoints where useful

Primary outputs:

- p50 / p95 / p99 latency
- requests/sec
- error rate
- memory
- CPU
- response size
- SSR/RSC durations where available

## Planned commands

- `deno task bench:browser`
- `deno task bench:server`
- `deno task bench:compare:local`

All three names now exist. `bench:compare:local` currently compares the latest
local artifacts per framework/runtime/project and now reports both **cold** and
**warm** request modes when artifacts exist for them.

## Cold vs warm request modes

- **cold**: measure the first request/navigation without priming caches
- **warm**: issue one warm-up request/navigation for the same scenario, then
  measure the next one

Examples:

- `deno task bench:browser -- --framework veryfront --runtime production-host --project blank --request-mode cold`
- `deno task bench:browser -- --framework veryfront --runtime production-host --project blank --request-mode warm`
- `deno task bench:server -- --framework nextjs --runtime production-host --project blank --request-mode warm`
- `deno task bench:browser -- --framework veryfront --runtime production-host --project blank --request-mode cold --profiling`
- `deno task bench:compare:local -- --runtime production-host --project blank`

Profiling note:

- request-phase profiling is off by default so benchmark numbers stay cleaner
- use `--profiling` when you want `/_metrics` profiling deltas attached to the
  benchmark result artifacts for diagnosis
