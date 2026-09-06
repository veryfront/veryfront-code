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

The service captures request accessors and routing primitives before project
modules load. Routing and CORS checks use those captured operations so later
changes to shared web prototypes cannot inspect the run-event or inference
credentials on an incoming request. Import the framework service runtime before
loading project modules. Custom host route handlers still receive the original
request and remain responsible for authentication and credential handling.
Dispatch visits the host route table and matched path segments by index so a
replaced array iterator cannot inject a handler before host authentication.
CORS allowlist membership, response header writes, and route path parsing also
use captured operations. Sparse route and origin arrays ignore inherited
entries. Route handlers retain ordinary-object params; decoded keys bypass
inherited setters.

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
