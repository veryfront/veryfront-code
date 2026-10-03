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

- **Model calls** use only the existing semantic `model.*` operations
  (`src/agent/hosted/executor-model-bridge.ts`). The host-side broker enforces allowed model IDs,
  grant admission, invocation authority and model-call persistence before dispatch
  (`src/agent/hosted/executor-model-dispatch.ts`). The executor has no raw path to the gateway.
- **Veryfront API calls** use a new `vf.egress` operation. It names a logical API route and its
  parameters, never a URL or a path.

For `vf.egress`, the host builds the URL from host configuration and the route's fixed template,
filters executor headers against an allowlist, attaches the credential for the route, and sends
through the origin-bound transport
(`createVeryfrontApiOriginBoundOutboundFetch`, `redirect: "error"`). No bearer, capsule or token
identifier crosses into the executor. A missing, expired or revoked vault entry fails closed before
anything is sent.

### Run binding and vault lifetime

The vault key is the full channel binding: `allocationId`, `generation` and `invocationId`. The host
creates the entry itself, when it allocates an executor for one authorized run, and records that
run's signed grant with the credentials: project, run, agent, run kind, and the resource selectors
fixed by the signed run configuration (for example the release ID and version of a release build,
or the artifact ID and attempt of a dependency build). The executor never supplies or chooses
the key. `createExecutorChannel` only checks that every frame carries the channel's own binding
(`src/agent/executor/channel.ts`, `#accept`). Binding a channel to a run, and every credential
decision, belong to the host.

- The transport is authenticated with a fresh per-allocation key and has no reconnect or replay
  (`src/agent/hosted/executor-node-transport.ts`, `src/agent/executor/channel.ts`). A new
  generation is a new allocation, with a new key and a new vault entry.
- Executor-facing credentials (the inference token and the runtime API token) are revoked when the
  invocation settles, when the allocation is revoked, or when the run deadline passes, whichever
  comes first. After that, every executor lookup fails closed.
- Run-control credentials (the stop, terminal and run-event tokens) are never reachable through
  `vf.egress`. Only the host's own run lifecycle uses them. They keep a separate, bounded lifetime
  that extends past the run deadline for settlement and acknowledgement, because the stop
  acknowledgement is sent after execution settles, which can be after the deadline
  (`createRunStopAcknowledger` in `src/server/handlers/request/project-run-execute.handler.ts`).
  They are revoked once the acknowledgement or terminal report is sent, or once that bounded window
  ends.
- A lookup for a binding this host process did not issue, or one already revoked, returns
  `CREDENTIAL_UNAVAILABLE`. Nothing is sent upstream. One run's binding can never resolve another
  run's credentials.

### `vf.egress` routes

Each logical route is a host-owned, frozen entry with:

- a fixed method and path template, such as a release asset upload under the run's project and
  release;
- typed parameters for each template segment;
- a query allowlist with typed values;
- the credential class it attaches;
- a request-body cap;
- for JSON bodies, a strict body schema that names which fields carry authority.

The host builds the path only from the template. It never appends a caller-supplied suffix.

- Each run kind grants only the routes it needs, such as release asset upload for a release build.
  A route outside the run's grant is refused.
- The project, the run, and every resource selector that the signed run configuration fixes come
  from the vault entry, never from the executor. That includes the release ID and version, and the
  dependency artifact ID and attempt. Fixed templates stop path traversal, but not substitution of
  another valid object. If the executor supplies a selector, the host rejects it unless it matches
  the vault value. Only parameters the configuration leaves open, such as an asset's content hash,
  come from the executor.
- Authority can also travel in a JSON body. Examples are the owner, parent run ID, agent ID and
  runtime target in the durable eval agent's run-creation request (`createDurableEvalAgentRunBody`
  in `src/server/handlers/request/project-run-execute.handler.ts`). Actions whose bodies carry
  authority, such as creating a run, are not `vf.egress` routes. They are semantic host operations
  that build those fields from the vault's signed grant, as the host builds them today.
- Every remaining JSON route validates its body against the route's strict schema before sending.
  The host buffers the body up to the route cap to do this. Any authority-bearing field must equal
  the vault value, and unknown fields are refused.
- Executor-supplied parameters must match their type and a strict segment pattern. The host refuses
  a value that is `.` or `..`, or that contains `/`, `\`, `%` or control characters. It also
  refuses any query name or value outside the allowlist.
- After construction, the URL must keep the configured origin and match the route template exactly.
  Otherwise the call is refused. This prevents same-origin requests to endpoints outside the route
  table.

### `vf.egress` request and response streaming

An executor operation takes one JSON input, and each protocol frame is at most 1 MiB
(`EXECUTOR_MAX_FRAME_BYTES` in `src/agent/executor/protocol.ts`). Credit flow control
(`EXECUTOR_STREAM_WINDOW`) applies to streamed results. API uploads can be up to 10 MiB
(`RELEASE_ASSET_MAX_SIZE_BYTES` in `src/release-assets/constants.ts`, and the upload operations in
`src/platform/adapters/veryfront-api-client/operations.ts`). Request bodies therefore never travel
inside the `vf.egress` input:

- **Head.** The `vf.egress` input carries only the request head: an opaque request ID, the route,
  its parameters and query, allowlisted headers, and whether a body follows. It is a stream
  operation, so the response comes back as a head frame followed by body chunk frames under the
  credit window.
- **Request body.** When a body follows, the host pulls it by calling the executor-installed
  `vf.egress.body` stream operation with the request ID from the head. This mirrors the request ID
  and the `http.request-body` operation in `src/server/isolated-http/executor-http.ts`.
  - An operation's context carries only the binding, signal and deadline, so the request ID is what
    pairs a body with its head when uploads run concurrently.
  - The executor serves each ID's body once. The host accepts a body only for a `vf.egress` call it
    has open on the same channel.
  - The channel shares one retention budget across all its streams (`EXECUTOR_MAX_RETAINED_BYTES`,
    enforced by `#retainPayload` in `src/agent/executor/channel.ts`). The credit window applies
    per stream.
  - The host therefore caps the streams open on a channel at 8. That count covers `vf.egress`
    calls and any other streaming operation on the same channel. Further calls wait for a free
    slot instead of overrunning the budget.
  - Call inputs count against the same budget. The channel retains each incoming request value
    until its handler settles (`#retainPayload` and the `finally` block of the incoming-call
    handler in `src/agent/executor/channel.ts`). The host therefore caps each `vf.egress` head at
    64 KiB and reserves `8 * 64 KiB` of the budget for call inputs.
  - Each encoded chunk is at most
    `(EXECUTOR_MAX_RETAINED_BYTES - 8 * 64 KiB) / (8 * EXECUTOR_STREAM_WINDOW)`, which is 120 KiB
    with today's constants. Maximum-size heads and full windows on every open stream then fit the
    budget together. Response chunks use the same size.
  - The host feeds the chunks to the upstream request through a pull-based stream, so a slow
    upstream stops the executor's producer.
- **Size caps per route.** Each route's body cap comes from that route's own contract, not from one
  cap for every JSON request.
  - Asset uploads are capped at `RELEASE_ASSET_MAX_SIZE_BYTES`.
  - The release asset manifest cap is derived from the worst-case encoded size that
    `RELEASE_ASSET_MANIFEST_LIMITS` allows. Every manifest the current API client can send must fit.
  - A route without a contract-derived bound is not added to the table until it has one.
  - The host counts streamed bytes. A body over its cap, or one that does not match a declared
    length, aborts the upstream request.
- **Response caps per route.** Each route also has a response cap derived from its contract. The
  default is no larger than the API client's current success-body limit
  (`DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES`, 64 MiB, in
  `src/platform/adapters/veryfront-api-transport.ts`). The host rejects a response whose
  `Content-Length` exceeds the cap, counts streamed response bytes before forwarding them, and
  aborts the upstream request once the cap is reached.
- **Abort.** Cancelling either stream, executor cancellation, vault revocation and the run deadline
  all abort the upstream request through one combined signal. A request body that ends early or
  fails never completes an upstream request. The upstream request is aborted, not sent truncated.
- **HTTPS only.** The origin-bound transport also accepts `http:` origins, so it is not enough on
  its own. Before attaching any credential, the host requires an `https:` origin
  (`requireHostPrivateApiHttps` in `src/config/host-api-base.ts`). It refuses the call otherwise.
  The `model.*` broker applies the same rule to the gateway origin
  (`requireSecureInferenceApiBaseUrl` in `src/provider/veryfront-cloud/shared.ts`).

A planned flag, `VERYFRONT_RUN_CREDENTIAL_ATTACHMENT=isolate|host`, will control rollout. It is not
implemented yet. With `host`, the shared host refuses credentialed runs instead of executing them in-process. An unset value means
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

## Implementation plan

Each step lands behind the flag, in pre-production first.

1. Interim shared-host fixes (#2188), including the `VeryfrontApiClient` transport.
2. A host-only run-credential vault keyed by the run binding. It stores the signed grant and
   resource selectors, revokes executor-facing credentials at settle, revoke or deadline, and keeps
   run-control credentials for a bounded post-deadline window. A test sends a stop acknowledgement
   after the deadline.
3. The `vf.egress` host operation. Its tests must cover:
   - the route table: fixed templates, typed parameters and query allowlists, with refusal of
     absolute paths, `..`, encoded separators and unlisted query values;
   - the header allowlist and HTTPS-origin checks;
   - credential class per route, and no route that reaches the model gateway;
   - request-body streaming: a 10 MiB upload streams through `vf.egress.body` while host memory
     stays within one credit window of frames;
   - concurrent uploads, eight at once against slow consumers, each paired with its own body by
     request ID, and staying within the channel's shared retention budget;
   - a ninth concurrent call waits instead of overrunning the budget;
   - eight maximum-size heads plus full chunk windows on every stream keep the channel open;
   - JSON body schemas: a substituted authority-bearing field and an unknown field are both
     refused, and run creation is reachable only through its semantic host operation;
   - response caps, including an oversized `Content-Length` and an oversized streamed response;
   - per-run route grants, and rejection of a release ID, release version, artifact ID or attempt
     that differs from the signed run configuration;
   - per-route size caps, including a worst-case schema-valid release manifest that must succeed;
   - abort on executor cancel, revocation and deadline;
   - fail-closed lookups for unknown or revoked bindings.
4. The executor-side transport and a bootstrap guard that rejects `VERYFRONT_*TOKEN*` variables.
5. A proof that no copy of the credential exists in the executor, including a memory scan, with a
   negative control on the shared host.
6. Wiring into the executor profiles.
7. The flag and the shared-host refusal.
8. Rollout and measurement against the latency budget.

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
