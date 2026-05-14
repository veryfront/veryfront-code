---
title: "Agents"
description: "Create an AI agent with a system prompt, tools, and memory."
order: 6
---

# Agents

Create an AI agent with a system prompt, tools, and memory.

Route examples below use the default app router. Veryfront Code also supports mounting the same handlers under `pages/api/**` when `router: "pages"` is enabled.

For the normal path, omit `model`. Veryfront Code uses runtime conventions:
local inference by default, and Veryfront Cloud defaults when
`VERYFRONT_API_TOKEN` plus project context are available.

## Define an agent

Create a file in `agents/`:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant. Answer concisely.",
});
```

The `id` is how you reference the agent later with `getAgent("assistant")`.

You can also define an agent with markdown when the agent only needs persona, model, and step configuration:

```md
---
name: Support
description: Helps users with support questions
model: openai/gpt-5.4
max-steps: 6
---

You are a support assistant. Answer clearly and ask for missing details before acting.
```

The file path provides the agent id. For example, `agents/support.md` registers `support` and can be invoked through the same project runtime and control-plane surfaces as `agents/support.ts`.

## Add tools

Agents call tools to take actions or fetch data. Reference tools by name — the framework resolves them from the `tools/` directory:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a weather assistant.",
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`maxSteps` limits how many tool-call iterations the agent can perform per request. See [Tools](./tools.md) for how to define `getWeather`.

## Enable skills

Skills are reusable instruction packs discovered from your project's `skills/` directory.

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a support engineer. Use skills when they match the task.",
  skills: ["incident-response", "repo-maintainer"], // or `true` for all discovered skills
  tools: {
    Read: true,
    "github:list-issues": true,
  },
});
```

When `skills` is enabled, the runtime automatically registers these skill tools:

- `load-skill`
- `load-skill-reference`
- `execute-skill-script`

See [Project Structure](./project-structure.md) for `skills/` conventions and [Configuration](./configuration.md) for discovery paths.

## Skill execution flow

For skill-aware agents, the recommended flow is:

1. Call `load-skill({ skillId })` to load the skill instructions and policy.
2. Optionally call `load-skill-reference(...)` to read files from `references/` or `assets/`.
3. Optionally call `execute-skill-script(...)` to run scripts from `scripts/`.
4. Continue with normal tool calls under the active skill policy.

The runtime enforces that non-skill tools cannot run before a successful `load-skill` when both are emitted in the same step.

## Skill script execution

Skill scripts run in one of two modes, selected automatically:

- **Local (development)**: When no Veryfront Cloud sandbox credentials are available, scripts run as direct subprocesses on your machine via `runCommand()`. No remote sandbox is needed.
- **Cloud (production)**: When `SANDBOX_AUTH_TOKEN`, `VERYFRONT_API_TOKEN`, or request-scoped Veryfront credentials are available, scripts are uploaded to and executed inside a remote sandbox session.

You don't need any sandbox infrastructure for local development — scripts just run directly.

## Skill safety model

- `allowed-tools` in `SKILL.md` is enforced at planning time and execution time (fail-closed).
- Skill file reads are restricted to the skill root and allowed subdirectories.
- Symlinked paths are rejected for skill file access.
- Script execution timeout defaults to `60000` ms and is capped at `300000` ms.

## Connect to a route

Use `getAgent()` to retrieve a registered agent and stream its response:

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

## Non-streaming response

For server-side generation (e.g., in `getServerData`), use `generate()`:

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
const result = await agent.generate({
  input: "Summarize the latest news about AI.",
});

console.log(result.text); // The agent's response
console.log(result.toolCalls); // Tools the agent called
console.log(result.usage); // Token usage
```

## Dynamic system prompts

The `system` property accepts a string, a function, or an async function:

```ts
export default agent({
  id: "assistant",
  system: async () => {
    const date = new Date().toLocaleDateString();
    return `You are a helpful assistant. Today is ${date}.`;
  },
});
```

For step-boundary refresh during a long-lived agent-service run, use
`resolveRuntimeState` instead of relying on `system()` to re-run mid-turn.
Agent service runtimes that fetch project instructions, skills, and
project-scoped tool inventory from an external control plane can use
`createDefaultAgentServiceProjectSteeringRefresh()` from
`veryfront/agent` to reuse the default refresh sequencing while keeping fetch and prompt-building policy
local. Use `fetchDefaultAgentServiceProjectSteering()` for the matching initial
execution-preparation fetch.
Services that prepare and stream agent-service executions through Veryfront Cloud can
use `prepareVeryfrontCloudAgentServiceChatExecution()`,
`createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions()`, and
`buildVeryfrontCloudRuntimeInstructions()` to reuse the default Veryfront Cloud
model normalization, model-provider, runtime system-message, durable root-run, and
stream-watchdog wiring. Agent services can also use
`loadAgentServiceEnvFiles()` before
`parseAgentServiceConfig()` to share the default env-file precedence and
environment contract for API URL, service MCP URL, port, CORS origins, durable
feature flags, and OpenTelemetry flags. Node services can pair that with
`createNodeAgentServiceRuntimeInfrastructure()` to reuse the default
config parsing, logger, service tracer, trace-context getter, and Node SDK
telemetry setup while keeping non-Node runtimes on the lower-level
observability APIs.
Use `resolveRuntimeAgentDefinitionsDir()` and
`loadRuntimeAgentMarkdownDefinitionFromFile()` when a separately deployed
agent stores persona/configuration in `agents/*.md` files.
If the service also uses the project-files API for instructions, skills,
and `load_skill`, use `createAgentServiceProjectSteering()` to bind the markdown
agent definition and project-steering adapter as one reusable service primitive.
For the standard Veryfront Cloud service shape, use
`startAgentService()` to bind those pieces in one cross-runtime
process entrypoint. The service entrypoint can stay small while agent behavior
lives in `agents/<agent-id>.md` or a discovered code agent such as
`agents/<agent-id>.ts`:

```ts
import { startAgentService } from "veryfront/agent";

await startAgentService();
```

To let the Veryfront control plane discover this separately deployed push
runtime, set the control-plane connection environment variables. The default
registration mode is `auto`: registration runs only when a token and public
service URL are present.

```bash
VERYFRONT_API_URL=https://api.example.com
VERYFRONT_API_TOKEN=<TOKEN>
VERYFRONT_PROJECT_ID=<PROJECT_ID>
VERYFRONT_AGENT_SERVICE_URL=https://agent.example.com
```

The service name defaults to `VERYFRONT_AGENT_SERVICE_NAME`, then the nearest
`package.json` or `deno.json` `name`, then `veryfront-agent-service`. Pass
`serviceName` only when code should override that convention.

Use `VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled` when startup must fail if the
service cannot register. Use `disabled` to opt out.

Use the lower-level helpers when a service needs custom tools, a custom
server adapter, or a different control-plane integration.

The cloud service helper uses the same project discovery conventions as normal
Veryfront projects: `agents/`, `tools/`, `skills/`, `resources/`, `prompts/`,
`workflows/`, and `tasks/`. When a project needs non-standard paths, configure
them in `veryfront.config.ts` under `ai.<primitive>.discovery.paths` instead of
adding service-specific discovery configuration.

When exactly one code or markdown agent is discovered, it becomes the default
automatically. The optional `agentId` setting selects the default agent for
direct `/api/runs` requests when a service exposes more than one agent.
Control-plane runtime invocations can target any discovered code or markdown
agent by setting `run.agentId` in the `/api/runs` payload. This lets one
deployed service expose multiple project agents while keeping direct chat
integrations on a predictable default.

## Agent configuration

| Property              | Type                                                                                                   | Description                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `id`                  | `string`                                                                                               | Unique identifier used with `getAgent()`                                     |
| `name`                | `string`                                                                                               | Human-readable display name for listings                                     |
| `description`         | `string`                                                                                               | Optional summary for listings                                                |
| `model`               | `string`                                                                                               | Optional provider/model override. Omit or use `"auto"` for runtime defaults. |
| `system`              | `string \| () => string \| Promise<string>`                                                            | System prompt                                                                |
| `resolveRuntimeState` | `(request: RuntimeStateRequest) => ResolvedRuntimeState \| Promise<ResolvedRuntimeState \| undefined>` | Refresh system/context before later model steps in the same run              |
| `tools`               | `Record<string, boolean \| Tool>`                                                                      | Tools the agent can use                                                      |
| `maxSteps`            | `number`                                                                                               | Max tool-call iterations per request                                         |
| `memory`              | `MemoryConfig`                                                                                         | Conversation memory settings                                                 |
| `streaming`           | `boolean`                                                                                              | Enable streaming (default: `true`)                                           |
| `middleware`          | `AgentMiddleware[]`                                                                                    | Execution middleware                                                         |
| `allowedModels`       | `string[]`                                                                                             | Restrict runtime model overrides to these `provider/model` strings           |
| `skills`              | `true \| string[]`                                                                                     | Enable all skills (`true`) or only specific skill IDs                        |

## Next

- [Tools](./tools.md) — define the tools your agent calls
- [Memory & Streaming](./memory-and-streaming.md) — add conversation memory

## Related

- [`veryfront/agent`](../reference/agent.md) — agent API reference
