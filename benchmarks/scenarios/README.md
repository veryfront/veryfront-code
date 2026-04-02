# Canonical Benchmark Scenarios

The files in this directory define the **framework comparison contract**.

A scenario should describe the user-visible or server-visible workload, not the
implementation details of a specific framework.

## Phase 1 scenarios

### 1. `static_route`

A light route with minimal server work and minimal client work.

Purpose:

- baseline TTFB/FCP/LCP
- baseline HTML payload size
- baseline framework overhead on a simple route

### 2. `ssr_data_route`

A server-rendered route that performs async data loading before responding.

Purpose:

- compare server latency and render cost
- compare SSR overhead under production settings
- observe p95/p99 under load

### 3. `interactive_hydrated_route`

A route that renders meaningful HTML and also hydrates client-side interaction.

Purpose:

- compare TTFB/LCP and interactive cost together
- surface JS payload and main-thread impact
- capture INP/TBT deltas across frameworks

### 4. `api_route`

A representative JSON API endpoint.

Purpose:

- compare request handling latency
- compare throughput and error rate under load
- capture non-HTML framework overhead

## Scenario design rules

- Keep payload/data shape matched across frameworks.
- Keep route semantics matched across frameworks.
- Prefer realistic but small workloads over synthetic extremes.
- Document any framework-specific compromises explicitly.
- Do not add a scenario unless at least two frameworks can implement it fairly.
