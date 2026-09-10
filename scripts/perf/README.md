# Framework performance

Run from the repository root with the Deno version in `.tool-versions`:

```bash
deno task perf --label=before
# Make one focused change, then compare on the same machine.
deno task perf --label=after --baseline=.cache/perf/before/results.json
```

Open `.cache/perf/after/index.html` in your browser. The report is a standalone
file with zoomable flamegraphs and links to Markdown, JSON, and CPU profiles.
Select a frame or focus it and press Enter to zoom. Select Reset to restore the
full graph. Load a `.cpuprofile` in Chrome DevTools for timeline and bottom-up
analysis. No service, browser extension, dependency, or Deno upgrade is
required.

Reusing a label replaces its previous reports and profiles when capture starts.
Use distinct labels to retain baselines. A failed capture leaves no previous
report under that label.

Keep generated profiles, benchmark results, and experiment notes in the ignored
`.cache/perf/` directory. Use CI artifacts to share captures. Do not commit
them.

Use `deno task perf --help` to discover options. The first run downloads the
repository's pinned dependencies. Subsequent runs reuse the Deno cache.

## Coding agent loop

```bash
deno task perf --scenario=http-ssr --label=before --json
# Edit only the measured hotspot and run its focused tests.
deno task perf --scenario=http-ssr --label=after --baseline=.cache/perf/before/results.json --json
```

JSON mode writes one envelope to stdout. Progress belongs on stderr. Read
`data.results.scenarios[].profile.hotspots` for sampled self time and inclusive
time, `latencyMs` for timing, and `comparison.changePercent` for the delta.
Negative change means lower latency. `summary.md` provides compact context for
an agent that does not need the full profile. Absolute profile paths and URL
queries are removed before artifacts are written. Generated module paths use
`[generated]` because runtime cache filenames can embed absolute source paths.
Hotspot aggregation retains script and column identity so sanitized URLs do not
combine unrelated functions.

Run `deno task perf:check` after changing the harness. It checks report types,
lint, formatting, and calculation tests. Run
`deno task test:file tests/integration/perf/runner.test.ts` to check task launch
permissions and generated reports. Run the focused runtime tests before keeping
an optimization.

## Measurement contract

- `request-timing` exercises the real request profiler, ten asynchronous phases,
  finalization, and Server-Timing serialization. Phase callbacks do no work so
  the result isolates instrumentation overhead.
- `ssr` builds 100 synthetic articles and renders them through `SSRRenderer` in
  production mode, including stream buffering, result validation, and one
  request profiling phase. It supplies the real React runtime using the same
  explicit runtime API as prepared applications.
- `http-api` exercises the production HTTP server and a route returning 100 JSON
  items. `http-cached` exercises a cached catalog page. `http-ssr` sends a
  synthetic cookie to bypass the shared page cache and render 100 articles in
  production. `http-dev` uses the same uncached page with local development
  compilation. Every response is consumed and checked for status, content,
  compile mode, and expected page-cache state. These fixtures use the real
  bootstrap, extensions, routing, transforms, security handlers, layouts, and
  HTML pipeline.
- HTTP load runs in a separate client process. Profiles, CPU time, and RSS
  belong to the server. Wall time includes loopback transport and client
  validation. Concurrency is one; this is not a saturation or maximum-throughput
  test.
- Server CPU totals exclude compiler subprocesses. Full-response latency
  includes time spent waiting for them.
- Each trial runs in a fresh process, measures the first operation separately,
  warms for 500 ms, and then measures a fixed-duration workload. The default is
  five trials of one second each. CPU time includes all process threads; RSS is
  an end-of-measurement snapshot, not peak memory or allocation count.
- A separate two-second-or-longer pass captures the CPU profile after timing.
  Profile percentages are diagnostic. Unprofiled measurements determine impact.
- The report records all trials, medians, spreads, runtime, CPU model, commit,
  working tree state, tracked runtime diff hash, and workload hash. The workload
  hash includes orchestration, report calculations, and the shared provider
  permission source. CI copies that permission source into the base checkout and
  runs profiling when it changes. Comparisons reject different runtimes,
  hardware labels, workloads, or trial settings. CPU model equality does not
  guarantee identical thermal or load conditions.
- Warm throughput is sequential and expressed as time per operation. The spread
  describes trial averages, not p95 or p99. HTTP results are full-response
  averages.
- Initial imports and setup occur before the first-operation timer. Neither
  microbenchmark measures complete HTTP requests. HTTP JSON includes server
  `startupMs` and `firstOperationMs` separately; these are diagnostic samples,
  not controlled cold-start benchmarks because dependency and OS caches persist.
  Hosted proxy services, browser hydration, application data services, and
  worker execution remain outside these fixtures.
- Workloads contain synthetic data, run with a cleared child environment, and
  receive no provider credentials. The two microbenchmarks deny runtime network
  access. HTTP servers allow network access for normal CDN dependency loading
  during bootstrap and initial rendering, with the test suite's inference
  provider deny list. HTTP clients allow only loopback. Warm fixtures contain no
  external data requests. First-run setup therefore needs network access; HTTP
  profiling is not an offline or hermetic benchmark. Generated projects and
  runtime caches are removed after each trial. Dependency resolution uses the
  frozen lockfile and normal Deno cache where the runtime supports them.
- HTTP workers enforce a 100-second deadline and terminate stalled clients so
  fixture cleanup runs before the runner's 120-second process timeout.
- HTTP workers allow subprocesses for the separate Deno client and the runtime's
  compiler executables, whose locations depend on the platform and dependency
  cache. They receive no FFI permission. Run these repository-owned fixtures in
  a trusted checkout; Deno permissions here support reproducible setup and do
  not provide isolation for untrusted code.

Keep the machine quiet during measurement. Repeat meaningful changes in reverse
order to detect warm-machine and scheduling bias. Treat small deltas within the
trial spread as inconclusive. Report absolute microseconds alongside
percentages. Use existing request phase timings and traces for time spent
waiting on I/O.

The flamegraph is an aggregate call tree, displayed with callers above callees.
Frame width is sampled time; horizontal position is not time order. Profiles
include runtime, garbage collection, profiler overhead, and idle samples. V8
locations may refer to transpiled JavaScript lines. Function totals can overlap
through recursion and must not be summed across rows.

## Automation

The `Framework performance` workflow runs for framework pull requests from
branches in this repository, including React runtime wrapper changes, every
Monday, and on manual dispatch. Pull requests measure their common ancestor with
the base branch using the same harness and runner before profiling the exact
head. This keeps later changes on the base branch out of the comparison. The job
summary shows deltas; the `framework-performance` artifact contains the full
reports. Scheduled and manual runs produce standalone baselines. Download the
artifact and open `ci/index.html` locally.

The workflow has read-only repository permissions and does not post comments.
Timing deltas are informational; harness or correctness failures still fail the
job. Do not make noisy hosted-runner latency a merge requirement. Changes to the
runtime pin, dependency lockfile, or dependency-related Deno configuration skip
the base comparison and establish a new baseline from the head. Task-only
configuration changes remain comparable. Workload changes also require a new
local baseline. The metadata check compares the configured lock setting and the
selected lockfile contents, workspace member dependency configuration, package
dependency metadata, and local import maps. Task-only member changes remain
comparable. Disabled locking, linked packages, nested or globbed workspaces,
remote import maps, and member JSONC syntax that requires a separate parser
establish a head baseline. Dependency configuration files throughout the
repository trigger profiling. When adding a custom lockfile or import-map
location, update the workflow path filter to include it. Compare dependency and
runtime migrations separately.
