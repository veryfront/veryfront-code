# Observability

This page describes logs, metrics, traces, request profiling, and error
collection. It does not cover monitoring HTTP handlers.

## Responsibility

Observability code records runtime events, metrics, traces, logs, request
profiles, and structured error collections across build, server, render, data,
cache, and agent paths.

Primary source areas:

- [`src/observability/`](../../src/observability/)
- [`src/observability/metrics/`](../../src/observability/metrics/)
- [`src/observability/tracing/`](../../src/observability/tracing/)
- [`src/observability/instruments/`](../../src/observability/instruments/)
- [`src/observability/auto-instrument/`](../../src/observability/auto-instrument/)
- [`src/errors/`](../../src/errors/)

## Runtime flow

1. Config and loader code determine enabled observability behavior.
2. Instrument factories attach metrics and tracing to supported runtime paths.
3. Error collectors normalize compile, build, route, and runtime errors.
4. Log subscribers and buffers expose recent runtime output.
5. Request profiling records route-level timing and resource use.

## OpenTelemetry Runtime Modes

OpenTelemetry exporter routing is process-level runtime configuration. In shared
Veryfront runtimes, the platform process owns `OTEL_*` and `VERYFRONT_OTEL`
values so one project cannot route another project's spans or metrics to a
tenant-controlled collector. Project code can still create framework spans and
metrics; the shared process decides where they are exported.

| Runtime mode                         | Telemetry config owner               | Supported behavior                                                                                                                             |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared multi-tenant/proxy runtime    | Platform host env                    | Supported. `OTEL_*` and `VERYFRONT_OTEL` are host-owned. Project env overlays are filtered before request execution.                           |
| Shared runtime project env/config    | Project env or `veryfront.config.ts` | Blocked. Project-controlled exporter endpoints, headers, service names, and resource attributes are ignored for shared runtime export routing. |
| Dedicated runtime or per-project pod | Project deployment env               | Supported. The process boundary isolates the project, so deployment env can point to a project-owned OTLP collector.                           |
| Local development                    | Developer env                        | Supported. Local env controls the local process only.                                                                                          |

Eval report exports are separate from regular runtime telemetry. Eval exporters
send explicit, redacted `EvalReport` payloads to selected exporters such as
Langfuse, LangSmith, Braintrust, or an internal gateway. OpenTelemetry trace IDs
can be attached for correlation, but OTLP trace or metric env vars do not route
eval report payloads.

## Server timing

When `VERYFRONT_ENABLE_SERVER_TIMING=1`, HTML and page-data responses include
renderer request phases in the `Server-Timing` header. In split proxy mode, the
proxy also appends proxy-prefixed phases:

- `proxy.total`: time from proxy request receipt to response header return.
- `proxy.resolve_request`: project, token, domain, and access resolution.
- `proxy.project_lookup`: combined project routing and proxy access metadata
  resolution time.
- `proxy.routing_lookup`: cacheable routing metadata lookup time. Cache hits
  are included and should be near zero.
- `proxy.access_lookup`: fresh protection and membership metadata lookup time.
- `proxy.resolve_server`: dedicated renderer server lookup.
- `proxy.retry_delay`: retry backoff time.
- `proxy.upstream`: fetch time from proxy to renderer response headers.
- `module.response_cache_hit`: release-scoped module response served from the
  runtime module response cache.
- `module.response_cache_distributed_hit`: release-scoped module response
  recovered from a configured shared cache before source lookup or transform.
- `module.response_cache_miss`: release-scoped module response was not cached
  and source lookup plus transform ran for the request.
- `module.response_cache_store`: release-scoped module response was stored for
  later cache hits.

The release module response cache uses a bounded in-process LRU for local pod
hits. Shared reuse across horizontally scaled pods is limited to API or Redis
cache backends. Disk and memory cache backends are not used as shared response
stores, which avoids container disk growth for immutable module responses.

Use client timing such as `curl -w '%{time_pretransfer} %{time_starttransfer}'`
with `proxy.total` to estimate edge, ingress, and network time before the proxy
pod receives the request. Use `proxy.upstream` minus the renderer `total` metric
to estimate proxy-to-renderer network and response header overhead.

## Boundaries

- Observability records behavior. It does not own business logic.
- Public monitoring routes belong in [server runtime](./04-server-runtime.md).
- Error type definitions and registry patterns belong in [`src/errors/`](../../src/errors/).
- In shared/proxy runtimes, telemetry exporter routing is platform-owned host
  configuration. Do not read `OTEL_*` routing values from project env overlays.
- Dedicated runtimes can use project-owned `OTEL_*` values because each project
  has its own process boundary.

## Change checks

- Add tests for metric names, trace attributes, log filtering, and error
  collection when changing instrumentation.
- Keep sensitive values out of logs and trace attributes.

## Related guides

- [Configuration](../guides/configuration.md)

## Related reference

- [`veryfront/observability`](../api-reference/veryfront/observability.md)
