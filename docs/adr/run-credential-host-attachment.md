# Run credentials are attached by a project-free host over the executor channel

Status: proposed. The owner chose option D in the issue tracker on 2026-10-03
(veryfront/veryfront-issue-inbox#2402). This ADR becomes accepted when its dependency, the
executor-side run profile and its activation (veryfront/veryfront-issue-inbox#2626), lands.

## Context

A project run (task, workflow, eval or agent run) receives bearer credentials from the control
plane: a runtime API token, an inference token, and run event, stop and terminal tokens. The run
uses them to call the Veryfront API and the model gateway.

In the shared production server, tenant code runs in the framework's own isolate
(`src/security/host-execution-policy.ts`), and the compiled binary has every Deno permission
(`scripts/build/compile-binary.ts`, `--allow-all`). In-isolate hardening (veryfront-code#4728,
#4729) keeps the credentials away from patchable JavaScript intrinsics. It cannot keep them out of
process memory or `/proc/self/*`, which tenant code can read with those permissions. A second
isolate or Worker in the same process has the same limit.

The goal of #2402 is that no copy of a run credential exists anywhere project code can reach.

## Options

| Option                                                               | Boundary                       | Added latency per credentialed call                                                     | Applies to all traffic              | Operational change                                                                                    |
| -------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A. Attach in the shared host isolate (today)                         | None                           | 0                                                                                       | n/a                                 | None                                                                                                  |
| B. Credential Worker in the same process                             | JS only; memory still readable | Worker round trip and a body clone                                                      | Yes                                 | Large serve-path refactor                                                                             |
| B'. Project code in a restricted Worker                              | JS plus Worker permissions     | Loopback broker hop                                                                     | No                                  | Worker isolation is unsupported in compiled binaries (`src/security/sandbox/isolation-capability.ts`) |
| C. Per-pod sidecar or egress proxy                                   | Separate container             | One extra hop on every request                                                          | Yes                                 | New container per pod                                                                                 |
| C'. Proxy mode (`src/proxy/`) as the hop                             | Separate process               | One extra network hop per credentialed call                                             | Yes, if the proxy token is included | Proxy role and API changes                                                                            |
| **D. Project-free host attaches over the isolated-executor channel** | **Separate pod**               | **One channel round trip per request head; streaming uses the channel's credit window** | **No**                              | **Executor stack must be active**                                                                     |

## Decision

Option D. Tenant code runs only in an isolated executor. The project-free host keeps every run
credential in a vault keyed by the executor's authenticated channel binding. The executor reaches
the gateway and the API only through two channel operations:

- the existing semantic `model.*` operations (`src/agent/hosted/executor-model-bridge.ts`), whose
  resolver runs on the host;
- a new `vf.egress` operation that names a logical route, never a URL.

The host builds the URL from host configuration, filters executor headers against an allowlist,
attaches the credential for the route's class, and sends through the origin-bound transport
(`createVeryfrontApiOriginBoundOutboundFetch`, `redirect: "error"`). No bearer, capsule or token
identifier crosses into the executor. A missing, expired or revoked vault entry fails closed before
anything is sent.

A planned flag, `VERYFRONT_RUN_CREDENTIAL_ATTACHMENT=isolate|host`, will control rollout. It is not
implemented yet. With `host`, the
shared host refuses credentialed runs instead of executing them in-process. An unset value means
`isolate`. Any other value, including a misspelled or malformed one, is a configuration error and
the server refuses to start. A typo then fails the rollout loudly: new instances never become ready
and the previous release keeps serving. Falling back to `isolate` instead would leave credentials in
the isolate while operators believe `host` is active.

## Facts established by the spike

The design rested on six assumptions. Each was checked against the code; the results below are what
this decision relies on.

1. **The host side of the executor channel cannot run under Deno. It runs on Node.js 22 or newer.**
   - The allocator client and the channel transport refuse non-Node runtimes before doing any I/O
     (`src/agent/hosted/executor-allocator-client.ts`, `createHostedExecutorAllocatorClient`;
     `src/agent/hosted/executor-node-transport.ts`, `validateOptions`). Under Deno,
     `isNodeRuntime()` is false because `process.versions.deno` is present
     (`src/platform/compat/runtime.ts`, `hasNodeProcess`).
   - Removing that guard would not help. The channel is TLS 1.3 with an external pre-shared key
     (`pskCallback`, no certificate). Deno 2.7.7's `node:tls` does not support it. A minimal
     reproduction with the transport's exact TLS options shows both failures:
     - a listener fails with "A key and certificate are required for `Deno.listenTls`";
     - a client never calls `pskCallback`, falls back to a certificate handshake, and the Node peer
       rejects it with `HandshakeFailure`.

     The same script succeeds under Node.js 24.
   - The host already uses only the connecting side (`connectExecutorTransport` in
     `src/agent/service/managed-broker.ts` and `src/server/isolated-http/hosted-http-broker.ts`).
     The listening side runs inside the executor (`src/agent/hosted/executor-node-bootstrap.ts`).
   - **Consequence:** the credential hop lives in a Node host process. For agent runs, that is the
     agent service, which already runs this framework on Node. For tasks,
     workflows and evals, the run-execution host is a Node deployment (veryfront-issue-inbox#2626),
     not the Deno compiled server. Porting the channel to certificate-based TLS so that Deno could
     host it would change the channel's authentication model, and is out of scope.

2. **Control-plane run requests reach the shared server through the same ingress path as
   application traffic**, not through a separate channel. This was verified against a deployed
   environment on 2026-10-03. The hop therefore does not change ingress routing.

3. **`VeryfrontApiClient` sends through a patchable transport.**
   - The canonical API transport calls the global `fetch` at request time when no outbound policy
     is configured (`src/platform/adapters/veryfront-api-transport.ts`, `doFetch`).
     `VeryfrontAPIOperations` configures none (`src/platform/adapters/veryfront-api-client/operations.ts`).
   - A probe that replaced `globalThis.fetch` received `Authorization: Bearer <token>` from a
     client built with an `apiToken`.
   - The token is also kept on a plain instance field (`client.ts`, `this.config`).
   - The release, dependency and style artifact builds in `project-run-execute.handler.ts` build
     this client with the run's runtime API token, so the token is exposed there today. This is an
     interim fix for the shared host, alongside the other global-`fetch` paths in #2188.

4. **No shared-server caller puts a run credential in `VeryfrontCloudContext.apiToken`.** The callers
   that put a request token there (`src/agent/hosted/default-chat-runtime.ts`, `createCloudContext`;
   `cloud-chat-execution-preparation.ts`; `context-summary-generator.ts`;
   `streaming/fork-runtime-stream.ts`; `application-model-resolver.ts`) run only in the hosted agent
   service or in the executor broker, never in the server's run handlers. Those processes load no
   tenant code. Under this decision they are the project-free host, so the credential belongs there.
   Two constraints follow:
   - the broker must never execute project code in-process;
   - the context store still uses live `AsyncLocalStorage.prototype` methods
     (`src/provider/veryfront-cloud/context.ts`), so capturing `run` and `getStore` at module load
     is cheap defence in depth.

5. **The shared server's deployment does not provide the ambient `VERYFRONT_API_TOKEN`.** This
   was verified against a deployed environment on 2026-10-03, and must be confirmed for each
   environment at rollout. The
   ambient-token fallback (`src/platform/cloud/resolver.ts`) is therefore not a run-credential
   source on the shared host. Executors will also refuse to start if any `VERYFRONT_*TOKEN*`
   variable is present.

6. **The executor stack is not active yet.** Making it active is a precondition, and is tracked in
   veryfront-issue-inbox#2626.

## Latency budget

The budget, measured against a baseline taken before the change, is:

- p50 time to first token: at most +5 ms;
- p95 time to first token: at most +15 ms;
- streaming throughput: at most 2% lower.

The baseline was measured in a deployed environment and is kept with the issue. Against current
model-call durations, the budget is well under 1% at both p50 and p95.

Time to first token is not recorded today: model-call spans cover the full response. Before the
comparison, the hop and the executor-side transport must record time to first chunk on the
model-call span.

## Consequences

- The acceptance criterion ("no copy in the isolate") is met only for executions that leave the
  shared host. While the flag is `isolate`, the in-isolate hardening from #4728, #4729 and #2188
  stays.
- The interim shared-host fixes (#2188) gain one item: route `VeryfrontApiClient` through a
  captured, origin-bound transport, and keep its token out of public instance state.
- The hop needs a Node host for every execution profile. The Deno compiled server never terminates
  the executor channel.
- The proxy mode's per-request token (`src/proxy/handler.ts`) on ordinary page and API traffic is not a run credential. Run code
  uses it through the same `VeryfrontApiClient` transport (the filesystem adapter), so it is
  exposed in the same way. It is tracked separately from this decision.
- Once production has used `host` for two release cycles, a later decision removes the in-isolate
  checks that only protect the shared host from executor builds.
