---
title: "Agent service runtime"
description: "Separately deployed Veryfront agent services and their runtime bootstrap helpers."
order: 10.3
---

# Agent service runtime

Use the agent service runtime when an agent runs as a separately deployed
service instead of an in-process application route.

This page covers the service bootstrap, discovery, registration, telemetry, and
Veryfront Cloud preset exposed by `veryfront/agent`.

## Service definition

`defineAgentService()` normalizes single-agent and multi-agent services into one
registry contract. `service.createRuntime({ routes })` creates a
request-native runtime with readiness, liveness, CORS, shutdown state, and
host-supplied routes.

```ts
import { agent, defineAgentService, type DurableRunSink } from "veryfront/agent";

const assistant = agent({
  system: "You are a hosted assistant.",
});

const durableRunSink: DurableRunSink = {
  startRun: () => ({ runId: "run_123" }),
  appendEvents: async () => {},
  finalizeRun: async () => {},
  cancelRun: async () => {},
};

const service = defineAgentService({
  serviceName: "support-agent",
  agent: assistant,
  durableRunSink,
});

const runtime = service.createRuntime({ routes: [] });
```

For Node deployments, `startNodeAgentService()` wraps the runtime in the shared
Veryfront service server with graceful shutdown.

## Veryfront Cloud bootstrap

Use `startAgentService()` from a process entrypoint when the service should use
the default Veryfront Cloud configuration, telemetry, model routing, sandbox,
project steering, durable-run, and prepared-execution wiring.

Keep agent behavior in `agents/<agent-id>.md` or `agents/<agent-id>.ts`.

```ts
import { startAgentService, veryfrontMcpServer } from "veryfront/agent";

await startAgentService({
  mcpServers: [veryfrontMcpServer()],
});
```

Discovery is rooted at the process cwd by default. The service name comes from
`VERYFRONT_AGENT_SERVICE_NAME`, the nearest `package.json` or `deno.json`
`name`, or `veryfront-agent-service`. Pass `serviceName` only when code should
override that convention. Pass `baseDir` when the service may start from a
different working directory. Pass `entrypointUrl` when deriving `baseDir` from
a module URL is more convenient.

If the service discovers exactly one code or markdown agent, that agent becomes
the default automatically. Set `agentId` when the service exposes multiple
agents or direct `/api/runs` requests should use a specific default.

## Remote MCP tools

Remote MCP servers are configured as an explicit list. Use normal MCP server
configs for third-party servers. Use `veryfrontMcpServer()` for
Veryfront-owned control-plane servers.

```ts
await startAgentService({
  serviceName: "support-agent",
  mcpServers: [
    veryfrontMcpServer(),
    veryfrontMcpServer("studio"),
    {
      id: "linear",
      endpoint: process.env.LINEAR_MCP_URL,
      headers: {
        Authorization: "Bearer <TOKEN>",
      },
    },
  ],
});
```

If `mcpServers` is omitted, the Veryfront Cloud preset includes
`veryfrontMcpServer()` by default. Pass `mcpServers: []` to run without remote
MCP tools.

For `veryfrontMcpServer()`, the runtime reads the control-plane `tool_access`
profile for the active project and filters mapped gated MCP tools before
exposing them to the model. If the profile is stale or unavailable, the runtime
hides mapped gated tools and leaves execution-time authorization to the API.
Third-party MCP servers are not affected by this Veryfront-specific visibility
profile.

## Control-plane registration

Control-plane registration is convention-first and explicit through
environment variables. In `auto` mode, `startAgentService()` registers the
service only when `VERYFRONT_API_TOKEN` and `VERYFRONT_AGENT_SERVICE_URL` are
present. Set `VERYFRONT_PROJECT_ID` to register a project-scoped runtime
service, or omit it for a global runtime service.

Set `VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled` to require registration
during startup, or `disabled` to opt out. The registered push service
heartbeats until the service shuts down.

```bash
VERYFRONT_API_URL=https://api.example.com
VERYFRONT_API_TOKEN=<TOKEN>
VERYFRONT_PROJECT_ID=<PROJECT_ID>
VERYFRONT_AGENT_SERVICE_URL=https://agent.example.com
VERYFRONT_AGENT_SERVICE_REGISTRATION=auto
```

`resolveAgentServiceRegistrationInput()` resolves the registration payload from
parsed config. It returns `null` in `auto` mode unless both
`VERYFRONT_API_TOKEN` and `VERYFRONT_AGENT_SERVICE_URL` are available. In
`enabled` mode, missing required settings fail startup.

`createAgentServiceRegistrationLifecycle()` registers a push runtime service
with `/agent-runtimes/push-services` and keeps it healthy by posting
heartbeats to the returned service id. The lifecycle exposes `stop()` so
service hosts can clear heartbeat timers during graceful shutdown.

## Project discovery

The Veryfront Cloud service preset discovers the same project primitives as the
project runtime:

- `agents/`
- `tools/`
- `skills/`
- `resources/`
- `prompts/`
- `workflows/`
- `tasks/`

Code agents are preferred when the same `agentId` is available from discovery.
Set `agentSource: "markdown"` to force markdown definitions. Use
`veryfront.config.ts` `ai.<primitive>.discovery.paths` for non-standard project
paths.

Control-plane runtime invocations can target any discovered code or markdown
agent by setting `run.agentId` in the `/api/runs` payload. This lets one
deployed service expose multiple project agents while keeping direct chat
integrations on a predictable default.

## Service runtime helpers

| Export                                                                  | Use                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `startAgentService()`                                                   | Run the default cross-runtime bootstrap for a Veryfront Cloud agent service.         |
| `createNodeVeryfrontCloudAgentServiceRuntime()`                         | Create the runtime bundle without starting a server.                                 |
| `startNodeVeryfrontCloudAgentService()`                                 | Start the Node server directly without the process bootstrap wrapper.                |
| `parseAgentServiceConfig()`                                             | Parse the default agent service environment contract.                                |
| `loadAgentServiceEnvFiles()`                                            | Load `.env` and `.env.local` before parsing config.                                  |
| `createNodeAgentServiceRuntimeInfrastructure()`                         | Create Node service config, logger, tracer, and telemetry infrastructure.            |
| `resolveNodeAgentServiceTelemetryConfig()`                              | Resolve Node OpenTelemetry config from the service environment.                      |
| `initializeNodeAgentServiceOpenTelemetry()`                             | Initialize the Node OpenTelemetry SDK for an agent service.                          |
| `discoverProjectAgentRuntime()`                                         | Discover project agents and primitives for runtime hosts.                            |
| `createRuntimeAgentFromMarkdownDefinition()`                            | Convert a parsed markdown agent definition into a runtime agent.                     |
| `loadRuntimeAgentMarkdownDefinitionFromFile()`                          | Load and parse a markdown agent definition from an `agents/` directory.              |
| `prepareVeryfrontCloudAgentServiceChatExecution()`                      | Prepare Veryfront Cloud chat execution with model, steering, and durable-run wiring. |
| `createVeryfrontCloudRuntimeSystemMessages()`                           | Create runtime system messages for Veryfront Cloud agent services.                   |
| `buildVeryfrontCloudRuntimeInstructions()`                              | Adapt prepared execution input into Veryfront Cloud runtime instructions.            |
| `fetchDefaultAgentServiceProjectSteering()`                             | Fetch initial project instructions and skills for execution preparation.             |
| `createDefaultAgentServiceProjectSteeringRefresh()`                     | Refresh project steering at model step boundaries.                                   |
| `createAgentServiceProjectSteering()`                                   | Bind markdown agent definitions to project steering and skill refresh.               |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions()`         | Create durable root-run preparation defaults.                                        |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions()` | Create prepared execution runtime defaults.                                          |

For conversation-backed host composition, use
[`Conversation-backed agent hosts`](./agent-conversation-control-plane.md).
