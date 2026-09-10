---
title: "Agent service runtime"
description: "Run Veryfront agents as separately deployed services."
order: 19
---

An agent service runs your agent as its own process, independent of the app server. Use it when you need a separate process boundary, direct control-plane registration, remote MCP tools, or deployment-owned service telemetry. Use a normal in-app route for everything else.

Veryfront Cloud can invoke a push runtime directly against an agent service, which is the main reason to deploy one even when the app and the agent share a host.

Shared and managed dedicated servers use the framework-owned `veryfront serve`
runtime instead. That runtime discovers all project agents and tools, then routes
each signed control-plane request by `agentId`. Projects on a managed dedicated
server do not require a `service.ts` entrypoint. Add one only when you
intentionally run the standalone Agent Service process described in this guide.

## Prerequisites

- At least one agent in `agents/` that the service should expose (see
  [Agents](./agents.md)).
- A deployment target you can run a long-running Node process on.
- For Veryfront Cloud registration: `VERYFRONT_API_TOKEN`,
  `VERYFRONT_PROJECT_ID` or `VERYFRONT_PROJECT_SLUG`, and a publicly
  reachable `VERYFRONT_AGENT_SERVICE_URL`. See
  [Configuration](./configuration.md) for the full list.
- Immutable deployment metadata for `runtimeSource` when the control plane
  invokes the service.

## Create a service entrypoint

Create a process entrypoint that starts the default Veryfront Cloud agent
service runtime:

```ts
// service.ts
import { startNodeVeryfrontCloudAgentService } from "veryfront/agent";

await startNodeVeryfrontCloudAgentService();
```

`startNodeVeryfrontCloudAgentService()` starts the runtime from the environment
that is already loaded. It does not load local `.env` files or initialize
process-wide telemetry. Load standalone service environment files through the
trusted deployment wrapper before it imports `service.ts`. Project modules
cannot mutate the shared process environment through the public agent API.

Initialize service-level OpenTelemetry in the trusted deployment wrapper before
it loads `service.ts`. Do not let project code select process-wide exporters,
trace hooks, or application-error reporters. The framework-owned
`veryfront serve` runtime owns this setup on shared and managed dedicated
servers.

The standalone service shares a process with the Agent code it loads. Use it
for trusted code. Captured request accessors protect specific ingress operations;
they do not provide process isolation for request bodies or credentials.
Custom host route handlers receive the original request and remain responsible
for authentication and credential handling.
Dispatch visits the host route table and matched path segments by index so a
replaced array iterator cannot inject a handler before host authentication.
CORS allowlist membership, response header writes, and route path parsing also
use captured operations. Sparse route, origin, method, and header arrays ignore inherited
entries. Route handlers retain ordinary-object params; decoded keys bypass
inherited setters.

Framework responses supply explicit status, status text, and empty-header defaults
to native constructors. These defaults override writable inherited data properties,
including CORS headers for a denied origin, and apply only to omitted values.
If `Object.prototype` defines an accessor for `headers`, `status`, or `statusText`,
response construction throws a `TypeError` before native option conversion can
invoke it. On Node, non-writable inherited data properties for these fields also
cause native construction to throw a `TypeError`. The runtime does not remove
these properties, return an empty response, or
retry with weaker CORS rules. Invalid response values still fail native
validation, and host handler errors propagate unchanged.

The service discovers the same project primitives as the app runtime:

- `agents/`
- `tools/`
- `skills/`
- `resources/`
- `prompts/`
- `workflows/`
- `tasks/`

When exactly one code or markdown agent is discovered, that agent becomes the
default for direct `/api/runs` requests. Pass `agentId` when the service exposes
multiple agents and direct requests need a predictable default.

## Keep agent behavior in project files

Define the agent in `agents/` and keep service startup separate from agent
behavior:

```ts
// agents/support.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "support",
  system: "You help users resolve support issues.",
  tools: {
    searchDocs: true,
  },
});
```

Markdown agents use the file path as the agent id:

```md
---
name: Support
description: Helps users resolve support issues
max-steps: 6
---

You help users resolve support issues. Ask for missing details before acting.
```

For non-standard project layouts, configure discovery paths in
`veryfront.config.ts` under `ai.<primitive>.discovery.paths`.

## Configure registration

Control-plane registration is convention-first. In `auto` mode, the service
registers only when `VERYFRONT_API_TOKEN` and
`VERYFRONT_AGENT_SERVICE_URL` are present. Registration also requires the
immutable `runtimeSource` binding described below.

```bash
VERYFRONT_API_URL=https://api.example.com
VERYFRONT_API_TOKEN=<TOKEN>
VERYFRONT_PROJECT_ID=<PROJECT_ID>
VERYFRONT_AGENT_SERVICE_URL=https://agent.example.com
VERYFRONT_AGENT_SERVICE_REGISTRATION=auto
```

When an agent service keeps control-plane traffic on an internal HTTP service
URL, set `VERYFRONT_PUBLIC_API_BASE_URL` to the environment's HTTPS API origin.
Run-scoped inference credentials use that public origin for provider gateway
requests and never travel over the internal HTTP connection.

Use `VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled` when startup must fail if the
service cannot register. Use `disabled` when the service must run without
control-plane registration.

The service name resolves from `VERYFRONT_AGENT_SERVICE_NAME`, then the nearest
`package.json` or `deno.json` `name`, then `veryfront-agent-service`. Pass
`serviceName` only when code should override that convention.

## Bind control-plane runs to the deployed source

A standalone agent service discovers one local project snapshot at startup. It
cannot select another project branch or release for an individual request. Bind
the service to deployment-owned immutable metadata when it accepts signed
control-plane runtime invocations:

```ts
import { startNodeVeryfrontCloudAgentService } from "veryfront/agent";

const environmentName = process.env.DEPLOYED_ENVIRONMENT_NAME;
const releaseId = process.env.DEPLOYED_RELEASE_ID;
if (!environmentName || !releaseId) {
  throw new Error("Missing immutable agent service deployment identity");
}

await startNodeVeryfrontCloudAgentService({
  runtimeSource: {
    type: "environment",
    environmentName,
    releaseId,
  },
});
```

The service accepts a control-plane invocation only when its `agentSource`
exactly matches `runtimeSource`. An unbound service returns
`CONTROL_PLANE_AGENT_SOURCE_UNBOUND`. A different release or environment
returns `CONTROL_PLANE_AGENT_SOURCE_MISMATCH`. Branch sources are mutable and
return `CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED`.

Do not resolve `runtimeSource` from the latest deployment at request time. Pass
the environment and release identifiers that produced the running service
artifact. Direct `/api/runs` requests do not select project source and do not
require this binding.

## Add remote MCP tools

Use `mcpServers` when the service needs remote tools. Use
`veryfrontApiMcpServer()` and `veryfrontStudioMcpServer()` for
Veryfront-owned control-plane MCP servers and normal MCP server config objects
for third-party servers.

This service startup config uses `endpoint` and `headers`. Per-agent config in
`agent({ mcpServers })` uses `transport`, `auth`, and `toolPolicy`.

```ts
import {
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "veryfront/agent";

await startNodeVeryfrontCloudAgentService({
  serviceName: "support-agent",
  mcpServers: [
    veryfrontApiMcpServer(),
    veryfrontStudioMcpServer(),
    {
      id: "linear",
      endpoint: process.env.LINEAR_MCP_URL,
      headers: {
        Authorization: ["Bearer", "<TOKEN>"].join(" "),
      },
      toolPolicy: {
        allow: ["search_issues", "create_issue"],
        approval: "never",
      },
    },
  ],
});
```

If `mcpServers` is omitted, the Veryfront Cloud preset includes
`veryfrontApiMcpServer()` by default. Pass `mcpServers: []` to run without
remote MCP tools.

### Reach trusted deployment-local MCP servers

The default remote MCP source uses guarded outbound networking. Keep that
default for third-party, request-derived, and tenant-configured endpoints.

A separately deployed agent service may need to reach a trusted MCP server on
a private cluster address. In that case, capture the host transport and the
exact allowed endpoints once at startup. Use the host transport only for those
immutable endpoints and preserve the guarded source for everything else:

```ts
import {
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "veryfront/agent";
import { createRemoteMCPToolSourceFactoryWithTransport } from "veryfront/tool";

function requiredUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const hostFetch = globalThis.fetch.bind(globalThis);
const createRemoteToolSource = createRemoteMCPToolSourceFactoryWithTransport({
  trustedEndpoints: [
    requiredUrl("VERYFRONT_MCP_URL"),
    requiredUrl("VERYFRONT_STUDIO_MCP_URL"),
  ],
  requestFetch: hostFetch,
});

await startNodeVeryfrontCloudAgentService({
  createRemoteToolSource,
  mcpServers: [
    veryfrontApiMcpServer(),
    veryfrontStudioMcpServer(),
  ],
});
```

The framework rejects invalid allowlist entries at startup and uses the host
transport only for an exact normalized URL match. Unmatched, invalid, and
resolver-based endpoints retain guarded outbound networking. `http:` is
appropriate only for private deployment-local networking; use `https:` for
public networks. Never put a callback endpoint or a per-request URL in the
trusted endpoint list.

## Refresh runtime state

Use `resolveRuntimeState` when a long-lived service run must refresh
instructions, context, or available tools at a model step boundary.

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "support",
  system: "You are a support assistant.",
  resolveRuntimeState: async ({ step }) => {
    if (step === 0) return;

    return {
      system: "Use the latest project instructions and tool inventory.",
    };
  },
});
```

Services that use Veryfront Cloud project steering can reuse
`fetchDefaultAgentServiceProjectSteering()` for the initial fetch and
`createDefaultAgentServiceProjectSteeringRefresh()` for step-boundary refresh.

Managed brokers can use `createManagedBrokerProjectState()` from
`veryfront/agent/managed-broker` for project instructions and skill catalogs.
The executor sends its effective tool selection on each steering refresh. The
broker validates that selection against the installed grant before constructing
instructions, and includes skills only when `load_skill` remains available.
Refreshes without a tool selection omit the skill catalog.

Managed broker ingress checks application strings and property names for known
credentials after URI decoding. Malformed escapes do not suppress checks on valid
encoded segments. Decoding is limited to 16 passes; ingress rejects strings that
still require decoding after that limit. Keep credentials out of executor data,
including encoded URLs and metadata.

Closing the managed broker handler or aborting its service signal returns 503
`BROKER_UNAVAILABLE` for pending admission. Request-only cancellation returns 499
`BROKER_INGRESS_ABORTED`.

## Keep inference authority separate

Signed runtime invocations may include an optional
`credentials.inferenceAuthToken` alongside the broader
`credentials.authToken`. The inference credential is bound to the exact run and
agent and is intended only for attributed Veryfront Cloud model requests. It is
size-bounded to 16 KB, uses visible ASCII token characters, and remains optional
so existing producers and consumers stay compatible.

Treat this as trusted-host authority. Do not copy it into project context,
tools, logs, durable request payloads, or a general API client. Framework-managed
agent services bind it only after the signed invocation and run-event credential
have been verified, bypass project model overrides for Veryfront Cloud models,
and send it only to an HTTPS (or loopback development) gateway. Custom runtime
adapters should follow the same boundary: use `authToken` for project and
control-plane operations, and expose `inferenceAuthToken` only to the model
subprocess's Veryfront Cloud gateway configuration.

## Use lower-level helpers

Use `startNodeVeryfrontCloudAgentService()` for the standard service shape.
Use lower-level helpers only when the service needs a custom server adapter,
custom execution preparation, or custom infrastructure.

| Helper                                             | Use                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `defineAgentService()`                             | Normalize one or more agents into a service registry contract.                       |
| `startNodeAgentService()`                          | Start a Node service around a request-native runtime.                                |
| `prepareVeryfrontCloudAgentServiceChatExecution()` | Prepare Veryfront Cloud chat execution with model, steering, and durable-run wiring. |
| `createAgentServiceProjectSteering()`              | Bind markdown agent definitions to project steering and skill refresh.               |

## Migrate custom durable child event writers

This migration applies to custom hosted runtimes that call the lower-level
durable child helpers. Framework-managed
`startNodeVeryfrontCloudAgentService()` runtimes create and scope writer
capabilities internally.

Raw `authToken`, `apiUrl`, and `runEventAppendToken` fields no longer grant
durable child event-writer authority. The parsed hosted request also excludes
the writer credential. Keep the credential inside trusted ingress and replace
the removed fields with an opaque `HostedRunEventWriterCapability`.

Apply the change at every integration point your custom runtime implements:

| Integration point                                                                                     | Migration action                                                                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ParsedHostedChatRequest` / `ParsedAgentServiceChatRequest`                                           | Stop reading `runEventAppendToken`; verified ingress retains it privately.                         |
| `PrepareHostedConversationRootRunContextInput` / `PrepareAgentServiceConversationRootRunContextInput` | Remove `runEventAppendToken`; keep the exact-root capability in trusted host composition.          |
| `ExecuteHostedDurableChildForkInput`                                                                  | Pass the exact-parent capability; this helper mints the exact-child capability after persistence.  |
| `DefaultHostedInvokeAgentToolOptions`                                                                 | Pass the current run's exact-parent capability.                                                    |
| `ExecuteHostedChildForkWithPreparedToolsInput` / `ExecuteHostedChildForkToolInputOptions`             | Pass a capability bound to `durableChildRun.childRunId`.                                           |
| `HostedDurableChildForkRunContextInput`                                                               | Remove `authToken` and `apiUrl`; pass the exact-child capability.                                  |
| `HostedDurableRunStartExecutionInput`                                                                 | Accept the required application-facing `rawRequest` in the starter callback.                       |
| `HostedAgentServiceDetachedExecutionInput` / `AgentServiceDetachedExecutionInput`                     | Accept the required application-facing `rawRequest`; internal control headers are already removed. |

The generated [`veryfront/agent` reference](../api-reference/veryfront/agent.md#type-reference)
lists the complete properties for these contracts.

1. After trusted ingress verifies an exact root-run append credential, create
   the root capability. Do not pass a general user API token.

   ```ts
   import {
     createHostedRunEventWriterCapability,
     executeHostedChildForkWithPreparedTools,
     executeHostedDurableChildFork,
   } from "veryfront/agent";

   const rootWriter = createHostedRunEventWriterCapability({
     apiUrl,
     runId: durableRootRun.runId,
     runEventAppendToken: verifiedRunEventAppendToken,
   });
   ```

2. Pass that exact-parent capability to helpers that own child persistence and
   capability delegation. Do not pre-mint for these helpers.

   ```ts
   const result = await executeHostedDurableChildFork({
     ...input,
     runEventWriterCapability: rootWriter,
   });
   ```

3. For lower-level helpers that receive an already-persisted `durableChildRun`,
   mint and pass an exact-child capability:

   ```ts
   const childWriter = await rootWriter.mintChildRunEventWriterCapability(
     durableChildRun.childRunId,
     abortSignal,
   );

   const result = await executeHostedChildForkWithPreparedTools({
     ...input,
     durableChildRun,
     runEventWriterCapability: childWriter,
   });
   ```

4. Update detached starter callbacks to accept the isolated request:

   ```ts
   const startDetachedExecution = async ({
     execution,
     abortSignal,
     rawRequest,
   }: HostedAgentServiceDetachedExecutionInput<Execution>) => {
     await host.start({ execution, abortSignal, request: rawRequest });
   };
   ```

A durable execution without authority bound to the expected run fails before
provider dispatch. Token exchange failures are bounded, sanitized, and fail
closed; callers must not retry by falling back to a user API token.

## Managed executor startup

`startExecutorRuntimeEntrypoint` is available from
`veryfront/agent/executor-runtime`. It starts the executor side of a managed
broker/executor deployment on Node.js 22 or newer. Your trusted image launcher
calls `initializeExecutorRuntimeContracts()` from the same export to initialize
the first-party schema validator, bundler, module lexer, and Skill document
parser, then supplies the Operator allocation environment and image
manifest. Missing runtime contracts fail startup.

The executor accepts one authenticated `runtime.install` message bound to its
allocation, invocation, generation, owner, and immutable source. Discovery remains
unavailable until installation succeeds. The trusted image launcher selects the
profile at startup; channel messages cannot change it.

### Installation profiles

| Startup `mode`      | Installation data                                                                      | Operations after installation                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `runtime` (default) | Runtime grant, capability IDs, optional host-tool aliases                              | `discovery.describe`, `agent.describe`, `runtime.prepare`, `agent.stream`                                   |
| `project-tools`     | Fixed agent/project/run context, canonical tool allowlist, call and concurrency limits | `discovery.describe`, `agent.describe`, `project.tool-aliases`, `tool.sources`, `tool.list`, `tool.execute` |

The full-runtime profile uses a separate bounded stream for initial checkpoint
state, so durable replay state can exceed the installation message limit.

The project-tools profile is selected by
`startExecutorRuntimeEntrypoint({ mode: "project-tools" })`. Its installation has
the following shape; the broker supplies the actual allocation and source identities:

```json
{
  "version": 1,
  "mode": "project-tools",
  "binding": {
    "allocationId": "allocation-example",
    "generation": 1,
    "invocationId": "invocation-example"
  },
  "owner": { "scopeKind": "project", "projectId": "project-example" },
  "source": { "type": "release", "releaseId": "release-example" },
  "root": "project",
  "context": {
    "agentId": "assistant",
    "projectId": "project-example",
    "runId": "run-example"
  },
  "allowedToolNames": ["inspect"],
  "maxCalls": 32,
  "maxConcurrent": 2
}
```

`allowedToolNames` contains unique canonical names, with at most 1024 entries.
`maxCalls` is an integer from 1 to 4096; `maxConcurrent` is an integer from 1 to 32.
The fixed context binds tool calls to the admitted canonical run. Correlation IDs,
cancellation and progress use the authenticated channel. This payload accepts no
runtime grants, private credentials or host capability IDs, and rejects unknown
fields. This profile exposes neither runtime preparation nor agent streaming;
the trusted broker owns the agent loop and privileged operations.

The fixed context also accepts optional `userId` and `projectSlug` from the approved
execution grant. Project tools receive those captured values; caller conflicts fail.
An explicitly enabled project source can receive the current call's `activeSkillId`
and bounded `activeSkillToolAvailability`. Omitted skill fields clear prior values.
Credentials and other caller context fields do not cross the project channel.
Unknown startup `mode` values fail before bootstrap configuration or artifact access.
Selected inline tools and discovered tools are combined under the exact project
source policy, including metadata access and later execution. Framework-generated
agent runtime tools are excluded from the project-only catalog, even when their
names appear in a grant.
The full-runtime profile applies the same source-policy scope while extracting
inline tools and reading their metadata during preparation.

### Broker composition

The broker owns HTTP authentication, credentials, model and tool authorization,
and durable persistence. Executor facades call these capabilities through the
authenticated channel. Closing a runtime revokes its facades; admission remains
held until the original work and cleanup settle. This entrypoint requires the
broker and isolation infrastructure to be configured separately.

Use `veryfront/agent/managed-broker` for the broker composition and signed
control-plane HTTP adapter. The broker installs invocation grants, describes
the selected agent, and prepares the executor before accepting a run. It keeps
model and tool execution unavailable during preparation. Configure detached
202 responses or request-owned SSE responses in trusted service configuration.
Signed, direct durable, and direct AG-UI ingress reject application strings or property
names containing a known broker credential, including credentials embedded in messages
or attachment URLs.
Detached runs require output persistence callbacks; their finalization remains
part of the session's owned work until all writes settle.

Canonical runs must pass the persistence adapter's `bindSessionOwnedWork`
callback in `ManagedExecutorStartInput`. The broker binds it after reserving a
session and before installation or preparation. Scheduled, retry, and explicit
event-queue writes use that session owner. A persistence timeout can return
promptly while pool capacity stays reserved until the original write settles.

`startNodeManagedAgentBroker` binds the signed stream, durable start, AG-UI,
and cancel/resume handlers to a Node server. Supply every handler, the broker
pool, and a readiness check explicitly. It preserves `/liveness` and
`/readiness`; shutdown stops admission before waiting for handlers and broker
work to retire. This server adapter does not configure product policy,
registration, credentials, or executor images.

Managed run routes return HTTP 400 with `BROKER_INGRESS_TARGET_MISMATCH` when
a run ID contains malformed URL encoding or fails the canonical run ID schema
after decoding. Run IDs contain 1 to 128 ASCII letters, digits, underscores,
or hyphens. Valid encoded run IDs are decoded before the handler receives them.
Signed stream requests must sign the original encoded request path.

To verify the packaged broker and executor locally, use Node.js 22.3.0 or newer:

```bash
deno task build:npm
deno task test:e2e:managed-broker
```

This suite installs the built packages and exercises signed HTTP ingress, a
separate executor over TLS, model and tool calls, SSE and detached responses,
executor termination, client cancellation, delayed terminal persistence, and
steering refresh with provider-native tools. Empty replay snapshots remain valid
when provider replay is disabled.
Project-controlled hooks use synthetic credential canaries with positive
controls. The npm smoke jobs run the suite on the minimum supported Node version
and the current CI version. These checks use local synthetic services. Verify
the deployed artifact and isolation configuration separately before traffic cutover.

## Verify it worked

Start the service entrypoint and call the run route directly. The default
port is `3001`; override with `PORT` if needed.

```bash
node service.ts &
curl -N http://localhost:3001/api/runs \
  -H "Content-Type: application/json" \
  -d '{"agentId":"support","messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"ping"}]}]}'
```

A working service streams AG-UI events back. If Veryfront Cloud registration
is enabled, the service should also appear in the cloud dashboard's agent
service list after the first heartbeat
(`VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS`).

Broker model output limits and provider-tool descriptors must stay within the installed model grant.
Each broker tool capability must also stay within the installed tool allowlist. Startup rejects broader
broker authority before allocating an executor. Preparation uses the narrower broker model output
limits and provider-tool list, so its default model requests fit the broker policy. Anthropic thinking
with an additive token budget reserves that budget from the total allowance before preparation chooses
the completion limit. Adaptive thinking uses the total allowance without an additive reservation.
Preparation rejects an explicit completion limit that exceeds the remainder. Source IDs must
belong to the installed host-facade or remote-source grants. Owner-scoped tool selectors use the same
canonical names for capability checks and steering refreshes.

Trusted ingress must provide `tools.catalog` with the complete tool inventory and ownership metadata,
including project-local tools that have no broker capability. The broker resolves short selectors to
owned tools first, then validates source capabilities against those exact IDs. Preparation and steering
refreshes receive the same resolved grant. A shadowed global tool does not gain authority from an owned
tool's short selector. The catalog must come from trusted source metadata before executor discovery.
For selected host tools, the broker includes the catalog's owner and short-name mapping in the
validated installation. Rebuilt executor facades retain that mapping, so an agent's short selector
continues to select the same canonical tool. Remote source listings do not supply ownership authority.
