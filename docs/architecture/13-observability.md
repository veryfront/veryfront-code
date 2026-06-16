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

## Server timing

When `VERYFRONT_ENABLE_SERVER_TIMING=1`, HTML and page-data responses include
renderer request phases in the `Server-Timing` header. In split proxy mode, the
proxy also appends proxy-prefixed phases:

- `proxy.total`: time from proxy request receipt to response header return.
- `proxy.resolve_request`: project, token, domain, and access resolution.
- `proxy.resolve_server`: dedicated renderer server lookup.
- `proxy.retry_delay`: retry backoff time.
- `proxy.upstream`: fetch time from proxy to renderer response headers.

Use client timing such as `curl -w '%{time_pretransfer} %{time_starttransfer}'`
with `proxy.total` to estimate edge, ingress, and network time before the proxy
pod receives the request. Use `proxy.upstream` minus the renderer `total` metric
to estimate proxy-to-renderer network and response header overhead.

## Boundaries

- Observability records behavior. It does not own business logic.
- Public monitoring routes belong in [server runtime](./04-server-runtime.md).
- Error type definitions and registry patterns belong in [`src/errors/`](../../src/errors/).

## Change checks

- Add tests for metric names, trace attributes, log filtering, and error
  collection when changing instrumentation.
- Keep sensitive values out of logs and trace attributes.

## Related guides

- [Configuration](../guides/configuration.md)

## Related reference

- [`veryfront/observability`](../api-reference/veryfront/observability.md)
