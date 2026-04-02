# Veryfront Performance Autoresearch

This workflow is inspired by the structure used in Shopify Liquid PR #2056,
but tailored for **Veryfront**, **Deno**, and our local cross-framework
benchmark harness.

## Goal

Give performance work a repeatable inner loop with:

1. a fast correctness gate
2. a stable local benchmark runner
3. machine-readable metrics for agent-driven iteration
4. optional comparison against the latest local **Next.js** baseline

## Commands

- `deno task perf:bench`
  - one full correctness + benchmark + compare pass
- `deno task perf:autoresearch`
  - repeated Veryfront benchmark runs, chooses the best run, and prints
    parseable `METRIC ...` lines

Useful flags:

- `--runtime production-host|preview-host`
- `--project <slug>`
- `--runs <n>`
- `--skip-verify`
- `--refresh-baseline`

## What gets measured

The current autoresearch loop tracks:

- cold and warm benchmark lanes for the same local scenarios
- browser static-route **TTFB**
- browser interactive-route **TTFB**
- browser interactive-route **LCP**
- browser interactive-route **INP**
- browser interactive-route **response bytes**
- server interactive-route **p95 latency**
- server interactive-route **RPS**
- server API-route **p95 latency**
- server API-route **RPS**
- cold→warm improvement metrics for the key browser/server latency signals
- deltas against the latest local **Next.js** benchmark artifacts when available

## Best-run score

The current best-run selector is intentionally simple and transparent:

- `browser_static_ttfb_ms`
- `browser_interactive_lcp_ms`
- `server_interactive_p95_ms`

These are summed into a temporary optimization score. Lower is better.
This score is a **ranking aid for local iteration**, not a public KPI.

The current overall score combines:

- cold-run score
- warm-run score

So autoresearch keeps pressure on both dynamic first-hit behavior and warmed
steady-state behavior.

## Constraints

- Keep the scenario contract in `benchmarks/scenarios/` authoritative.
- Do not add benchmark-only product hacks.
- Keep Next.js as a local comparison baseline, not a build-time dependency of the framework.
- Preserve the **general JIT-friendly architecture** of Veryfront:
  - prefer stable object shapes and monomorphic hot paths
  - avoid benchmark-specific branching that makes production paths less predictable
  - avoid micro-optimizations that trade away readability or system boundaries without a measured gain
- Treat browser correctness regressions as release blockers, not acceptable perf tradeoffs.

## Suggested loop

1. make a small performance hypothesis
2. run `deno task perf:autoresearch -- --runs 3`
3. inspect `METRIC ...` output and `auto/results/*.json`
4. keep only changes that improve metrics without breaking verification
5. run `deno task perf:bench -- --refresh-baseline` before broader review
