---
title: "Agent service runtime"
description: "Run Veryfront agents as separately deployed services."
order: 19
---

An agent service runs your agent as its own process, independent of the app server. Use it when you need a separate process boundary, direct control-plane registration, remote MCP tools, or service-level telemetry. Use a normal in-app route for everything else.

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

## Create a service entrypoint

Create a process entrypoint that starts the default Veryfront Cloud agent
service runtime:

```ts
// service.ts
import { startAgentService } from "veryfront/agent";

await startAgentService();
```

The bootstrap discovers the same project primitives as the app runtime:

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
`VERYFRONT_AGENT_SERVICE_URL` are present.

```bash
VERYFRONT_API_URL=https://api.example.com
VERYFRONT_API_TOKEN=<TOKEN>
VERYFRONT_PROJECT_ID=<PROJECT_ID>
VERYFRONT_AGENT_SERVICE_URL=https://agent.example.com
VERYFRONT_AGENT_SERVICE_REGISTRATION=auto
```

Use `VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled` when startup must fail if the
service cannot register. Use `disabled` when the service must run without
control-plane registration.

The service name resolves from `VERYFRONT_AGENT_SERVICE_NAME`, then the nearest
`package.json` or `deno.json` `name`, then `veryfront-agent-service`. Pass
`serviceName` only when code should override that convention.

## Add remote MCP tools

Use `mcpServers` when the service needs remote tools. Use
`veryfrontApiMcpServer()` and `veryfrontStudioMcpServer()` for
Veryfront-owned control-plane MCP servers and normal MCP server config objects
for third-party servers.

This service startup config uses `endpoint` and `headers`. Per-agent config in
`agent({ mcpServers })` uses `transport`, `auth`, and `toolPolicy`.

```ts
import {
  startAgentService,
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "veryfront/agent";

await startAgentService({
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

## Use lower-level helpers

Use `startAgentService()` for the standard service shape. Use lower-level
helpers only when the service needs a custom server adapter, custom execution
preparation, or custom infrastructure.

| Helper                                             | Use                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `defineAgentService()`                             | Normalize one or more agents into a service registry contract.                       |
| `startNodeAgentService()`                          | Start a Node service around a request-native runtime.                                |
| `createNodeAgentServiceRuntimeInfrastructure()`    | Create Node config, logging, tracing, and telemetry infrastructure.                  |
| `prepareVeryfrontCloudAgentServiceChatExecution()` | Prepare Veryfront Cloud chat execution with model, steering, and durable-run wiring. |
| `createAgentServiceProjectSteering()`              | Bind markdown agent definitions to project steering and skill refresh.               |

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
