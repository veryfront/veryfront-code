# Dedicated proxy memory footprint design

## Context

The `veryfront-staging` proxy rollout of framework v0.1.1186 repeatedly exits with code 137 and Kubernetes records `OOMKilled`. The failing container has a 1536 MiB memory limit. Older v0.1.1185 proxy replicas remain healthy, and renderer replicas using the same v0.1.1186 universal binary survive only because they have a 4 GiB limit.

Artifact and cgroup profiling isolates the regression to the compiled universal framework binary:

- The Linux x64 universal binary grew from 887,756,293 bytes in v0.1.1185 to 951,154,705 bytes in v0.1.1186.
- A minimal `--version` invocation reproduces the failure before proxy traffic, Redis, Sentry, or renderer work starts.
- Commit `339367a6dd85` added explicit compiled-binary includes for Sharp, Lightning CSS, and PurgeCSS extensions. That change added about 78 MB to an ARM64 binary and about 234 MB to startup peak memory in the profiling environment.
- Reducing V8 old-space or disabling Sentry does not prevent the OOM because the dominant cost is the embedded module and dependency archive in the monolithic binary, not the JavaScript old heap.

Draft veryfront-code PR #3280 already establishes the correct producer seam: a dedicated proxy entrypoint, a graph-specific Deno lock, explicit proxy provider composition, a proxy release asset, an exact proxy SBOM, and provider smoke tests. The compatible veryfront-server consumer work is already on its main branch: it resolves and verifies a separate proxy asset while retaining a universal-binary fallback. The remaining work is to complete the approved release contract and exercise the dedicated binary in the actual container entrypoint.

## Goals

- Preserve every existing universal `veryfront-*` release asset and its public CLI/runtime behavior.
- Publish dedicated `veryfront-proxy-linux-x64` and `veryfront-proxy-linux-arm64` assets.
- Keep proxy behavior shared between the universal CLI and dedicated binary so the optimized artifact does not create a second proxy implementation.
- Prove the x64 dedicated proxy starts successfully three consecutive times under the existing 1536 MiB cgroup limit.
- Make veryfront-server select the dedicated binary only for proxy mode, while retaining the universal binary for renderer mode and as a legacy fallback.
- Restore staging with a temporary 1 GiB request and 2 GiB limit, then right-size from measured startup and steady-state usage.

## Non-goals

- Slim or otherwise change the existing universal binary.
- Remove optional extensions, renderer/RSC support, build support, or CLI commands from public release assets.
- Redesign proxy request handling, caching semantics, observability, or shutdown behavior.
- Treat a larger memory limit as the root fix.
- Add a new third-party dependency.

## Considered approaches

### Dedicated entrypoint and release assets

Compile a proxy-only static graph with the providers used by hosted proxy deployments. Publish separate Linux artifacts and let veryfront-server select them in proxy mode.

This is the selected approach. It creates a clear deployment boundary, preserves the universal binary contract, and removes unrelated renderer, build, document, image, and CSS dependency graphs from proxy startup.

### Reduced include list with the universal CLI entrypoint

Compile `cli/main.ts` with fewer explicit includes. This retains the general CLI router, environment bootstrap, esbuild initialization, and broad command graph. Its memory reduction is less reliable and future CLI imports can silently grow the proxy again.

This approach is rejected because the artifact would still carry code outside the proxy responsibility and lacks a durable dependency boundary.

### Resource increase only

Raise the proxy limit until the universal binary starts. This can restore availability, but it leaves the packaging regression intact and makes future universal-binary growth a deployment risk.

This approach is retained only as temporary rollout headroom, not as the fix.

## veryfront-code design

### Entrypoint and lifecycle

`cli/proxy-main.ts` is the dedicated compiled entrypoint. It statically anchors only the first-party providers required by hosted proxy deployments and then delegates to the shared standalone proxy runtime.

The shared runtime owns:

- logger initialization and startup output;
- `PORT` and `HOST` resolution;
- cache, Redis, Sentry, and OpenTelemetry provider activation;
- proxy module loading;
- extension teardown and shutdown integration;
- the compiled-process keep-alive lifecycle.

The existing `veryfront serve --mode=proxy` path must use the same runtime wrapper. This keeps functional behavior and shutdown semantics aligned across universal and dedicated binaries.

The dedicated entrypoint accepts the existing server invocation shape. Extra CLI words such as `serve --mode=proxy` are tolerated for rollout compatibility, while `PORT` and `HOST` remain the authoritative hosted configuration.

### Compile profiles

`scripts/build/compile-binary.ts` keeps the universal profile as the default. The proxy profile uses:

- `cli/proxy-main.ts` as the entrypoint;
- only runtime-resolved proxy files as explicit includes;
- `--node-modules-dir=none`;
- a frozen graph-specific `scripts/build/proxy-deno.lock`.

The graph-specific lock is required because a compiled Deno binary embeds locked npm packages. Reusing the workspace lock would pull unrelated packages such as Sharp and esbuild back into the proxy even when their source modules are not imported.

CI regenerates the proxy lock and fails if the committed lock differs. The proxy SBOM is generated from that exact lock.

### Release assets

The release matrix adds:

- `veryfront-proxy-linux-x64`, built and smoke-tested on Linux;
- `veryfront-proxy-linux-arm64`, cross-compiled on Linux and released for architecture parity.

Existing artifact names and contents remain unchanged. The x64 artifact keeps a deterministic size ceiling as a fast packaging-regression guard. The cgroup smoke test is the behavioral memory guard.

### Memory regression gate

The Linux x64 proxy binary must cold-start and answer its health endpoint three consecutive times inside a Docker cgroup with a 1536 MiB memory limit. Each attempt must:

1. start the exact compiled release binary with the memory cache;
2. answer the proxy health endpoint;
3. terminate cleanly;
4. report no container OOM termination.

The test uses the existing limit rather than the temporary 2 GiB rollout limit so CI retains measurable safety headroom. The existing provider smoke suite continues to cover Redis cache selection, ambient Redis registration, OpenTelemetry, and Sentry separately.

## veryfront-server design

### Asset resolution

The Docker build continues to download and checksum the universal Linux x64 binary. When the release contains `veryfront-proxy-linux-x64`, it also downloads and checksums that artifact. For older releases, `/usr/local/bin/veryfront-proxy` remains a hard link to the universal binary.

Repository-dispatch builds from a new framework release require the dedicated proxy asset. Pull-request and ordinary compatibility builds may use the legacy fallback so older release fixtures remain testable.

### Runtime selection

The container command selects binaries by `VERYFRONT_MODE`:

- `proxy`: execute `/usr/local/bin/veryfront-proxy serve --mode=proxy ...` when executable, otherwise execute the universal fallback;
- `production` or the existing default: execute `/usr/local/bin/veryfront serve --mode=production ...`.

The selected runtime must become PID 1 so Kubernetes signals reach it directly. The container entrypoint test must exercise the Dockerfile's real default command for renderer, dedicated proxy, and legacy fallback cases rather than injecting an equivalent shell fragment only in the test.

### Staging resources

Set the staging proxy request to 1 GiB and limit to 2 GiB for the first dedicated-binary rollout. The request reflects the known historical steady-state footprint while the limit protects rollout availability during measurement.

After the dedicated artifact is live, record cold-start peak and steady-state working set from the container cgroup and Kubernetes metrics. Reduce the request or limit only after observed peaks show adequate margin. The intended end state is not to normalize multi-gigabyte proxy memory.

## Error handling and compatibility

- A missing or malformed proxy checksum fails release-driven server builds instead of silently deploying an unverified binary.
- Legacy releases may fall back to the universal binary only in compatibility paths that explicitly allow fallback.
- Invalid cache modes fail with a direct configuration error.
- Provider activation failures run registered teardown and preserve the original startup failure.
- Existing proxy environment variables, routes, health endpoint, observability behavior, and signal semantics remain unchanged.
- Existing universal release assets remain byte-for-byte governed by the universal build profile.

## Verification

### veryfront-code

- Focused tests for compile-profile arguments, lock freshness, excluded dependency classes, proxy runtime lifecycle, and provider composition.
- Bash syntax checks for smoke scripts.
- Proxy x64 compile and provider smoke suite.
- Three cold starts under a 1536 MiB Docker memory limit.
- Proxy ARM64 cross-compile.
- Format, lint, typecheck, and the repository's standard test gates.
- Release workflow assertions proving both proxy assets are uploaded and the proxy SBOM uses the proxy lock.

### veryfront-server

- Asset resolver tests for dedicated, fallback, missing, and malformed digest cases.
- Docker build test using a dedicated proxy fixture.
- Default-entrypoint tests for renderer, dedicated proxy, and legacy fallback, including PID 1 and SIGTERM behavior.
- Helm/schema validation for the 1 GiB request and 2 GiB limit.

### Staging rollout

- Verify the new proxy pod uses the dedicated artifact image.
- Verify readiness and health responses.
- Verify zero `OOMKilled` events and zero restarts through repeated cold starts or a rollout observation window.
- Record peak and steady-state memory before changing the temporary resource envelope.

## Rollout order

1. Complete and merge the dedicated proxy producer in veryfront-code.
2. Publish a framework release containing both proxy assets and their digests.
3. Let the existing veryfront-server release dispatch resolve the x64 proxy asset and build the server image.
4. Land the real runtime selector and staging resource values in veryfront-server before deploying that image.
5. Deploy staging and verify health, restarts, OOM events, and memory measurements.
6. Keep the legacy fallback until all supported server release paths require the dedicated artifact.

## Risks

- A dynamically loaded provider can be omitted from the proxy graph. Static provider anchors, the frozen proxy lock, provider smoke tests, and exact SBOM make this failure visible.
- Dedicated and universal proxy behavior can drift. A shared runtime wrapper and shared extension composition keep the behavioral code path singular.
- A size-only gate can miss high runtime allocation. The cgroup cold-start test covers the actual failure mode.
- Cross-compiled ARM64 cannot be executed on the x64 CI runner. It is compile-validated there; x64 remains the deployed and memory-gated server artifact.
- Temporary 2 GiB headroom can become permanent without measurement. The staging acceptance report must include observed peak and steady-state memory and a follow-up sizing recommendation.
