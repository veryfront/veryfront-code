---
title: "Agents"
description: "Create an AI agent with a system prompt, tools, and memory."
order: 19
---

An agent is a file in `agents/` that exports a system prompt, optional tools,
optional memory, and optional skills. The runtime auto-discovers it on startup
and exposes it via `getAgent(id)` or a route created with `createAgUiHandler()`.

For the normal path, omit `model` and let runtime conventions choose: local
inference by default, Veryfront Cloud when `VERYFRONT_API_TOKEN` plus project
context are set.

## Prerequisites

- A Veryfront project running locally (see
  [Create project](../getting-started/create-project.md)).
- A provider configured for inference (see [Providers](./providers.md)).
- The `agents/` directory exists. If you customised `ai.agents.discovery.paths`
  in [Configuration](./configuration.md), use that directory instead.

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

You can also define an agent with markdown when the agent only needs persona,
model, and step configuration:

```md
---
name: Support
description: Helps users with support questions
model: openai/gpt-5.4
max-steps: 6
---

You are a support assistant. Answer clearly and ask for missing details before
acting.
```

The file path provides the agent id. For example, `agents/support.md` registers
`support` and can be invoked through the same project runtime and control-plane
surfaces as `agents/support.ts`.

## Per-agent skills and tools

A markdown agent can own its skills and tools by using a directory instead of a
single file. Put the agent definition in `AGENT.md` and colocate its
capabilities beside it:

```
agents/
  researcher/
    AGENT.md            # the agent definition (frontmatter + instructions)
    SKILL.md            # the agent's own skill, loaded as veryfront__load_skill("researcher")
    skills/
      cite/SKILL.md     # an extra skill, loaded as veryfront__load_skill("researcher--cite")
    tools/
      fetch-paper.ts    # a colocated tool, registered as "researcher--fetch-paper"
```

The directory name is the agent id. The flat `agents/{id}.md` form still works
for agents that do not own skills or tools, and both layouts can coexist.

Colocated capabilities are registered with owner metadata and namespaced
`{agentId}--{name}`. Ownership controls visibility everywhere: an agent only
ever sees unowned (project-global) capabilities plus its own - never another
agent's. This one rule applies to `skills:` and `tools:` for every agent kind
(TypeScript, flat markdown, and directory markdown):

```md
---
name: Researcher
model: anthropic/claude-sonnet-4-6
skills: true # all skills visible to this agent (global + own)
tools: [fetch-paper] # own short names resolve first, then global tool ids
---

Research the question and cite every claim.
```

- Omit `skills` or use `skills: true` to advertise and authorize every skill
  visible to the agent. Use `skills: []` to advertise none and to authorize no
  project or configured skill for `veryfront__load_skill`.
- The difference between omitting `skills` and `skills: true` shows only when a
  project has no skills at all. An agent that omitted it gets no skill tools,
  because there is nothing for them to load. `skills: true` is a declaration,
  so the tools stay whatever the registry holds.
- `tools: true` - every currently scoped tool is authorized, while non-bootstrap
  schemas are deferred behind `veryfront__tool_search` until the agent searches for them.
- `skills: [..]` / `tools: [..]` - each entry resolves as the agent's own
  short name first, then as a global id. A colocated short name that shadows a
  global id is reported at discovery so the reference stays unambiguous.
- Use `denied-tools: [..]` in Markdown agent frontmatter to preserve explicit
  tool denials. `deniedTools` is also accepted for serialized definitions. Do
  not combine either form with `tools: true`: the serialized runtime cannot
  represent "all except", so it fails closed and disables every project tool.
  Client tools that a run request supplies still reach the model unless the
  agent denies them by name. List the allowed tools explicitly when you also
  need denials.
- Duplicate agent ids (flat file + directory) and agent ids whose sanitized
  namespaces collide are reported as discovery errors.
  The same catalog metadata is used by local and hosted runtime paths. Hosted
  skill loading uses the catalog `sourcePath`, not a path reconstructed from the
  namespaced id, so `veryfront__load_skill("researcher--cite")` resolves to the actual
  colocated `SKILL.md`.

## Add tools

Agents call tools to take actions or fetch data. Reference tools by name: the
framework resolves them from the `tools/` directory:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a weather assistant.",
  temperature: 0,
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`temperature` controls model sampling and defaults to `0`. It does not guarantee
repeatable output. Runtime provider capabilities may omit or normalize the value
for models that reject generic sampling parameters or require mode-specific
values.

`maxSteps` limits how many tool-call iterations the agent can perform per
request. See [Tools](./tools.md) for how to define `getWeather`.

Set `parallelToolCalls: false` to request one tool call at a time from providers
that support this control. Markdown agents accept `parallel-tool-calls: false`
or `parallelToolCalls: false` in frontmatter. Omit the option to preserve the
provider's default. This setting controls tool-call batching; it does not force
the model to call a tool or change which tools it may use.

File-read results from the immediately preceding user turn retain their content
and version metadata so follow-up edits can use the file evidence. Older reads
and large non-file results are compacted normally. Under context pressure, the
existing best-effort token budget can still summarize the preceding turn.

If a provider stops without producing assistant text or a new tool call after
a completed tool, the runtime uses one remaining step to ask it to continue
from the existing tool results. It preserves those results rather than
rerunning the prior step. A second empty response, or an empty response with no
remaining step, fails the run with `EMPTY_RESPONSE` instead of completing with
an empty answer.

## Load broad tool catalogs progressively

The `tools` selector controls both authorization and initial schema exposure:

- Omit `tools` to expose no project tools.
- Use an explicit map to expose only those selected schemas immediately.
- Use `tools: true` to authorize every tool in the current scope while initially
  exposing only bootstrap tools and `veryfront__tool_search`.

A successful search makes matching authorized schemas visible on the next model
step.

Set `toolLoading: "deferred"` to use the same lookup flow with an explicit tool
map. Authorization stays limited to the selected tools; lookup cannot enable a
denied tool. Set `toolLoading: "eager"` to load schemas upfront. Omission preserves
the existing defaults above. Deferred inventories show up to 20 descriptions;
`veryfront__tool_search` also finds authorized tools omitted from that initial inventory.

Tool schema compatibility follows the model backend as well as its wire protocol. Veryfront Cloud
Mistral models retain root `oneOf` tool schemas, including each variant's required fields and
`additionalProperties` constraints. Native OpenAI models retain their root schema restrictions.

### Expose a startup tool set

To expose a small startup set while leaving the rest of the catalog deferred,
set `bootstrapTools` to up to 16 exact executable tool names. The selection does
not grant access or replace the trusted skill loader. The runtime rejects names
outside the authorized catalog, `veryfront__tool_search`, and selections that exceed the
model's schema limit. Per-step skill and execution restrictions still apply, so
a startup tool removed by those restrictions is unavailable on that step. Other
authorized tools remain discoverable. Omit `bootstrapTools` to keep the default
startup set.

```ts
import { agent } from "veryfront/agent";
import { tool } from "veryfront/tool";

const readMarker = tool({
  id: "read_marker",
  description: "Read the current marker",
  inputSchema: { type: "object", properties: {} },
  execute: () => ({ marker: "ready" }),
});

export default agent({
  system: "Use recorded tool results to answer questions.",
  tools: { read_marker: readMarker },
  toolLoading: "deferred",
  bootstrapTools: ["read_marker"],
});
```

In Markdown agent definitions, use `bootstrap-tools` with the same list. In
eager mode, all selected tools are already exposed; the startup selection does
not make that mode deferred.

### Expose optional startup schemas

Use `optionalBootstrapTools` for capabilities that may be absent from a run's
final authorized catalog. Unlike required `bootstrapTools`, missing or denied
optional tools are skipped, so a read-only run can start without a write tool.
Authorized optional schemas are exposed initially when the model's tool limit
has room; required bootstrap schemas and discovery capacity take precedence.
This setting never grants access. Per-step restrictions still apply.

```ts
export default agent({
  system: "Use the available project tools.",
  tools: true,
  bootstrapTools: ["read_project"],
  optionalBootstrapTools: ["create_file"],
});
```

Each list accepts up to 16 exact executable names. In Markdown, use
`optional-bootstrap-tools`. Both startup selections apply to root runs;
hosted child runs do not inherit them.

### Child transcripts in chat

`veryfront__invoke_agent` forwards child text and tool activity through the parent
chat stream. The child card updates while the child runs and retains its visible
transcript after completion. This uses the same event format with or without a
Veryfront Cloud connection. Standalone execution requires model credentials;
Cloud run history is optional. Reload replay depends on the application's chat
storage.

### Bound large tool results

Set `toolResultContext: true` to keep oversized results out of later model calls.
The default inline limit is 16 KiB. Larger results become a run-scoped reference
with a 4 KiB preview; the framework supplies `veryfront__get_tool_result` for reads of up to
16 KiB per section. The result identifies its total size and next cursor.

```ts
import { agent } from "veryfront";

export default agent({
  system: "Use tools to answer the user's questions.",
  toolResultContext: {
    maxInlineBytes: 8192,
    previewBytes: 2048,
    maxSectionBytes: 8192,
    maxStoredResults: 256,
  },
});
```

Persisted messages, result events, and callbacks retain the original data. Small
results remain inline. Skill instructions, schema lookup results, and retrieved
sections remain visible rather than being wrapped in another reference.

For `invoke_agent` and `veryfront__invoke_agent`, provider replay includes identical
child response text once while preserving summary metadata and the original
durable result envelope.
Both chat replay and text-generation requests use this normalization, including
JSON-encoded persisted child results. A completed child with accepted structured
`output` sends that value and lifecycle metadata to the provider, including JSON
scalars and `null`. Its original
prose stays in durable history, so intermediate trace descriptions cannot
conflict with the accepted result. Completed child results keep root response
hint instructions and metadata while omitting their suggested prose when accepted
output or child response text is present. Successful local child summaries use
the same hint cleanup. Both aliases require framework-owned result provenance;
project-owned or unmarked historical results retain their original fields. Runtime-written ownership metadata restores unique child results on replay.
Child projection runs before result-reference previews and sections are built;
the original result remains in durable history.
Failed children retain diagnostic prose.
Distinct textual summaries and outputs retain their existing behavior.
Result references limit inline payloads, not child generation or the total
conversation size; reading every section can still grow model context.
JSON-encoded child envelopes matching the projection rules above are decoded
before replay; other encoded results retain their string representation. Raw
output already contained in annotated response text is omitted from the provider
projection.
When storage is full, later oversized results become bounded preview-only
payloads with `complete: false`, no reference, and
`retrievalUnavailable.reason: "capacity_exceeded"`. Existing references remain
readable, and raw run history and events retain the original results. Storage
has hard limits of 16 MiB per serialized result and 64 MiB per run. Byte options
are limited to 1 MiB and the result count to 1,024.
Omission or `false` preserves inline results. Per-call replacement tools opt out
of this framework behavior.

```ts
const assistant = agent({
  name: "release-assistant",
  model,
  system: "Use the release tools to answer project release questions.",
  tools: true,
});
```

The framework `veryfront__tool_search` fallback is provider-neutral. It searches the
authorized `tools` catalog and configured `providerTools` that the selected
model supports. Provider-native entries contain only a name and description
until a search loads them. The runtime attaches the provider's native schema on
the next model step.

Search ranks an exact tool name first, followed by normalized substrings in the
tool name, description, and input parameter descriptions. It returns at most
five names and descriptions. Results never include schemas, and `veryfront__tool_search`
has no pagination options.

Loading a schema never authorizes a tool. The runtime rechecks authorization
before execution. It also filters restored loaded-tool state against the
currently authorized catalog.

You can use deferred loading with a direct provider and its API key without
Veryfront Cloud. Hosted durable runs additionally require the Veryfront API
durable run-event contract. The hosted runtime stores loaded-tool state in a
private checkpoint and waits for that checkpoint before continuing. Private
checkpoint data does not appear in public messages or replay. Configured,
supported provider-native tools use the same private exposure checkpoint.
Provider replay is not part of this feature.

See [Tools](./tools.md#how-agents-use-tools) for the search and execution flow.

## Enable provider tools

Provider tools are executed by the selected model provider. They are not local
tools and they are not MCP tools.

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
  system: "Research current information before answering.",
  providerTools: ["web_search"],
});
```

The runtime only enables provider tools that the selected provider/model
supports.

## Connect MCP servers

Use `mcpServers` for remote MCP-compatible tool servers. Put visibility policy
on the server that owns the tools. When `tools` is an explicit object, include
the remote MCP tool name in `tools` and authorize it with the server
`toolPolicy`.

Explicitly named tools that are not local are resolved from the Veryfront API
MCP server when `mcpServers` is omitted and the server bootstrap is available.
This lets a project pulled from Studio run locally without repeating transport
configuration. `VERYFRONT_API_URL` selects the API endpoint;
`VERYFRONT_API_TOKEN` and `VERYFRONT_PROJECT_SLUG` provide server-side identity.
These environment variables do not grant tools by themselves.

```ts
export default agent({
  id: "project-reader",
  system: "Read project files when needed.",
  tools: { get_file: true, list_files: true },
});
```

Only the explicitly named unresolved tools are requested from the remote MCP
catalog. Remote `tools/list` remains authoritative, and browser AG-UI context
cannot replace server identity. Set `mcpServers: []` to opt out. An explicit
`mcpServers` list overrides the default; use `{ kind: "veryfront-api" }` with a
`toolPolicy` when the connection policy should travel with the agent.

```ts
// agents/docs.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "docs",
  system: "Use the docs server when the user asks about internal docs.",
  tools: { search_docs: true },
  mcpServers: [
    {
      id: "docs",
      transport: {
        type: "http",
        url: "https://docs.example.com/mcp",
      },
      auth: {
        type: "bearer",
        token: () => process.env.DOCS_MCP_TOKEN ?? "",
      },
      toolPolicy: {
        allow: ["search_docs"],
        approval: "never",
      },
    },
  ],
});
```

## Use skills

Skills are reusable instruction packs discovered from your project's `skills/`
directory. Agents with enabled skill access receive the visible skill catalog
and `veryfront__load_skill` automatically. Omitted `skills` uses the visible catalog when
one exists; `skills: false` and `skills: []` remove skill access.

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a support engineer. Use skills when they match the task.",
  tools: {
    Read: true,
    github__list_issues: true,
  },
});
```

Use `skills: ["incident-response", "repo-maintainer"]` to advertise and
authorize only those skills. Use `skills: []` to advertise no skills and to
authorize none for `veryfront__load_skill`. An explicit selector is an authorization
boundary for `veryfront__load_skill`, not just a prompt filter.

Local and project runtimes also expose `veryfront__load_skill_reference` and
`veryfront__execute_skill_script`. Hosted chat reads an advertised reference through
`veryfront__load_skill({ reference: { skillId, file } })` and does not execute skill
scripts directly.

For essential guidance at startup, set `bootstrapSkill` to one authorized skill
ID. The framework loads that skill's root through its trusted skill loader before
the first model call and records the load in the run history. This does not grant
skill or tool permissions, and reference bodies remain deferred. The serialized
root response, including its reference index, must fit within 16 KiB; an
oversized root fails the run instead of being truncated. Keep the root focused on
navigation and process, and put detailed guidance in references. The run fails
before any model call when the agent has no authorized framework skill loader or
the skill is not authorized. Omit `bootstrapSkill` to start without a preloaded
skill. Use an exact skill ID or the agent's own short name, not a selector pattern.
Hosted children load only the target agent's own configured startup skill.
The parent's startup skill is not inherited. Loading runs once before the child's
first model call; its instructions remain in history across tool steps and
continuations. Hosted preparation retains the original trusted load and its full
root, without loading it again. If that root cannot survive the existing context
budget, preparation fails before inference. A fresh fork authorizes its own load;
serialized history does not grant skill activation. Later steps fail before inference
if that original authenticated result becomes missing, ambiguous or changed. In Markdown agent definitions,
use `bootstrap-skill`.

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "planner",
  system: "Plan the requested work.",
  skills: ["planning"],
  bootstrapSkill: "planning",
});
```

See [Project structure](./project-structure.md) for `skills/` conventions and
[Configuration](./configuration.md) for discovery paths.

## Skill execution flow

When an agent uses a skill, the flow is:

1. Call `veryfront__load_skill({ load: { skillId } })` to load the skill instructions and policy.
2. Read an advertised reference with `veryfront__load_skill_reference(...)` on local and
   project runtimes, or `veryfront__load_skill({ reference: { skillId, file } })` in hosted
   chat.
3. On local and project runtimes, optionally call
   `veryfront__execute_skill_script(...)` to run scripts from `scripts/`.
4. Continue with normal tool calls. Loading a skill does not change which
   tools the run may call.

A step may batch `veryfront__load_skill` with other tool calls. The runtime runs the calls
in the order the model emitted them. A successful `veryfront__load_skill` changes only
which skill's instructions are loaded and which reference and script files
`veryfront__load_skill_reference` and `veryfront__execute_skill_script` can reach for later calls.
Ordinary tools are unaffected, whether they were emitted before or after
`veryfront__load_skill`, and a failed `veryfront__load_skill` does not block the rest of the batch.

## Skill script execution

Skill scripts run in one of two modes, selected automatically:

- **Local (development)**: When no Veryfront Cloud sandbox credentials are
  available, scripts run as direct subprocesses on your machine via
  `runCommand()`. No remote sandbox is needed.
- **Cloud (production)**: When `SANDBOX_AUTH_TOKEN`, `VERYFRONT_API_TOKEN`, or
  request-scoped Veryfront credentials are available, scripts are uploaded to
  and executed inside a remote sandbox session.

Local development does not require sandbox infrastructure. Scripts run as direct
subprocesses.

## Skill safety model

- `allowed-tools` in `SKILL.md` is **not** enforced. The Agent Skills
  specification defines it as pre-approval metadata (tools an agent may run
  without prompting), not an authorization boundary, so Veryfront records the
  declaration and does not restrict the run. Narrow a run by configuring the
  agent's tools, not by declaring `allowed-tools` in a skill.
- Skill file reads are restricted to the skill root and allowed subdirectories:
  `references/`, `resources/`, `assets/`, and `scripts/`.
- Symlinked paths are rejected for skill file access.
- Script execution timeout defaults to `60000` ms and is capped at `300000` ms.
  Cloud scripts use background sandbox commands above `55000` ms so the
  synchronous API limit does not shorten your configured timeout. Commands are
  canceled at the configured deadline, and the executor closes its sandbox.
  Truncated cloud script output returns output-limit exit code `125`, including
  partial output and an explanatory error.

## Connect to a route

Expose a registered agent through `createAgUiHandler()` when a browser or
external client needs AG-UI streaming.

Use [Create agent](../getting-started/create-agent.md) for the copyable
quick-start route. Use [Chat UI](./chat-ui.md) to pair that route with
`useChat()`.

If a route returns `Agent not found`, ensure the agent file is in `agents/` and
its `id` matches the value passed to `createAgUiHandler()`.

## Non-streaming response

For server-side generation (e.g., in `getServerData`), use `generate()`.
`getAgent()` returns `Agent | undefined`, so narrow the result before calling
it. Without the guard, the sample fails typecheck under the `"strict": true`
tsconfig that `veryfront init` writes.

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
if (!agent) throw new Error("Agent not found: assistant");

const result = await agent.generate({
  input: "Summarize the latest news about AI.",
});

console.log(result.text); // The agent's response
console.log(result.toolCalls); // Tools the agent called
console.log(result.usage); // Token usage
```

### One-shot calls

For a single call with no tools and no follow-up turn - an extraction, a
classification, a rewrite - you do not need an agent at all. Use `generate`
from `veryfront/llm`:

```ts
import { generate } from "veryfront/llm";

const { text } = await generate({
  model: "anthropic/claude-sonnet-4-6",
  system: "Extract the invoice total. Reply with the number alone.",
  input: invoiceText,
});
```

It runs one step with no tools, skills or memory, and takes the same
`outputSchema` an agent does.

Like an agent, `generate` blocks prompt injection in its input and masks PII
such as email addresses in its output by default. Pass `security: false` to
keep those values, for example when you extract contact details. This turns off
both protections, so only use it on input you trust.

Reach for an agent instead when you need the thing itself rather than the
answer: a registered id other code resolves, tools, memory across turns, or a
system prompt built at request time. To hold such an agent to a single
tool-free turn, say so:

```ts
const extractor = agent({
  id: "extractor",
  model: "anthropic/claude-sonnet-4-6",
  system: "Extract the invoice total. Reply with the number alone.",
  skills: false,
  maxSteps: 1,
});
```

`maxSteps: 1` stops the runtime from taking a second turn it has no use for.
`skills: false` removes the `veryfront__load_skill` family from the request in a project
that does have skills - an agent with one job should not be offered a catalog
it will never open.

## Structured output

Set `outputSchema` to constrain every response to a schema. Veryfront maps it to
the selected provider's native structured-output field, then parses and
validates the model's text back into `response.data`, typed from the schema
with no annotation of your own. `response.object` remains a compatibility alias.

```ts
// agents/weather.ts
import { agent } from "veryfront/agent";
import { defineSchema } from "veryfront/schemas";

export const getForecastSchema = defineSchema((v) =>
  v.object({
    city: v.string(),
    tempC: v.number(),
  })
);

export default agent({
  id: "weather",
  system: "You report weather.",
  outputSchema: getForecastSchema(),
});
```

```ts
import { agent } from "veryfront/agent";
import { getForecastSchema } from "./weather.ts";

const weather = agent({
  id: "weather",
  system: "You report weather.",
});

const result = await weather.generate({
  input: "What is it like in Berlin?",
  outputSchema: getForecastSchema(),
});

if (result.data === undefined) {
  throw new Error(result.metadata?.outputSchemaError ?? "Forecast output is missing");
}
console.log(result.data.city); // string
console.log(result.data.tempC); // number
```

Pass `outputSchema` to `generate()` or `stream()` to constrain a single request
instead; a per-call schema replaces the configured one. `generate()` returns
`data` typed from the per-call schema when you pass one. A raw JSON Schema
object is accepted in both places and is sent to the provider unchanged.

A requested schema is never dropped silently. A model runtime that does not
support structured output rejects the request, and output that does not parse or
does not validate raises rather than returning a partial object.

A run that stops at the step limit still returns its partial result instead of
raising. On that path the final assistant text is parsed best effort: a
successful parse sets `response.data` and its `response.object` compatibility alias,
while a parse or validation failure sets
`response.metadata.outputSchemaError` next to the max-steps warning so the
failure stays visible.

When the hosted runtime runs an agent, its AG-UI stream reports a JSON snapshot
of the parsed value as `result` on the `RunFinished` event, and the Runs API
stores that snapshot as the run's `output`. The event has no `result` when the
agent declares no `outputSchema`, when the output did not parse, or when the run
failed or was cancelled. See [Run input and output](./run-input-output.md) for
what an agent run stores as input and output.

`response.data` in your own code is always the parsed value; `response.object`
contains the same value for compatibility. The snapshot
equals it when the value is plain JSON (strings, finite numbers, booleans,
`null`, arrays and plain objects) and stays within the size limits below.
Otherwise, for example when an `outputSchema` transform returns a `Date`, a
`bigint`, `NaN`, `Infinity` or `undefined`, or when a string is too long, the
stored value is a marker object instead:

```json
{
  "captureStatus": "partial",
  "reasons": ["unsupported_object", "unsupported_property"],
  "value": { "title": "Report", "createdAt": "[unsupported object]" }
}
```

- `captureStatus` is `partial` when some of the value was captured, or
  `unsupported` when none of it could be.
- `reasons` lists why, for example `unsupported_object`, `unsupported_bigint`,
  `unsupported_number`, `unsupported_undefined`, `unsupported_property`,
  `accessor_property`,
  `circular`, `max_depth`, `array_truncated`, `object_keys_truncated`,
  `string_truncated`, `aggregate_budget_exhausted`, `object_key_unsupported`
  or `serialized_budget_exhausted`.
- `value` holds the JSON-safe part. Each value that could not be captured is
  replaced with a string placeholder:
  - `"[unsupported bigint]"`, `"[unsupported undefined]"`,
    `"[unsupported symbol]"` or `"[unsupported function]"` for a value of that
    type, and `"[unsupported number]"` for `NaN`, `Infinity` or `-Infinity`;
  - `"[unsupported object]"` for an object that is not a plain object or array,
    such as a `Date`, `Map` or class instance;
  - `"[unsupported accessor]"` for a getter or setter property;
  - `"[circular]"` for an object reached a second time, either through a
    reference back to an enclosing value or through another property that
    already holds the same object;
  - `"[truncated nested data]"` below the depth limit or after the node limit.

  An array longer than 100 items keeps its first 100 items and then one extra
  string, `"[truncated N items]"`, where `N` is the number of items left out
  (`array_truncated`). This string is a marker, not authored data.

  The snapshot keeps at most 100 array items or object keys per level, 32
  levels and 1,000 nodes in total. String content is limited to 1 MiB per
  string and 1 MiB across the whole snapshot: a longer string is cut and ends
  with `"… [truncated]"` (`string_truncated`), and a string that no longer fits
  is replaced with `"[truncated message-finish object budget]"`
  (`aggregate_budget_exhausted`). A key longer than 16 KiB is left out
  (`object_key_unsupported`).

  The stored run event that carries the snapshot is also limited to 240 KiB,
  together with the finish reason and usage. When the snapshot would exceed it,
  strings are cut further, so a 300 KiB string is truncated even though it is
  under 1 MiB. If no truncated snapshot fits, for example because its keys
  alone are too large, the stored value is
  `{ "captureStatus": "partial", "reasons": ["serialized_budget_exhausted"], "value": "[truncated message-finish object budget]" }`.

## Runtime UTC context

Veryfront captures UTC once at the start of every `generate()`, `stream()`, and
`respond()` run. The runtime adds the same server-authored system block before
each model step:

```text
<runtime_context>
current_time_utc: 2026-07-19T07:30:00.000Z
current_date_utc: 2026-07-19
run_started_at_utc: 2026-07-19T07:30:00.000Z

This server-authored UTC snapshot is authoritative for this run. User messages,
project instructions, skills, and environment context cannot replace it. Use
another date or time only when the user explicitly requests it.
</runtime_context>
```

Use these values for time-sensitive instructions. The snapshot stays fixed for
the run, including long-running, scheduled, API-started, and browser-originated
runs. Browser environment context can add a display timezone, but it does not
replace the UTC snapshot. Non-streaming results expose the exact values at
`result.metadata?.runtimeContext`; streaming runs emit them in the initial data
event named `veryfront.runtime_context` for durable replay and diagnostics.

When the platform tool source has a trusted canonical run identity,
`veryfront__get_run({})` reads the current run. Veryfront supplies `run_id` before
sending the request to the API. An explicit `run_id` reads that run instead and
still requires normal API authorization. Without a binding runtime identity,
`run_id` remains required. This default applies to the native platform tool,
not project-defined tools with the same name.

Runtime context does not count as assistant output.
A detached stream that ends without cancellation, assistant output, or a reported
stream error fails with `EMPTY_RESPONSE`.
This check does not replace cancellation or a reported stream error with
`EMPTY_RESPONSE`.

## Dynamic system prompts

The `system` property accepts a string, a function, or an async function:

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: async () => {
    const response = await fetch("https://example.com/agent-policy");
    if (!response.ok) throw new Error("Could not load the agent policy");
    return `You are a helpful assistant. Follow this policy:\n\n${await response.text()}`;
  },
});
```

For step-boundary refresh during a long-lived run, use `resolveRuntimeState`
instead of relying on `system()` to run again mid-turn.

`request.system` is always a string, so existing text transformations remain
compatible. When the runtime has structured system messages, use
`request.structuredSystem` to read their provider metadata and return
`structuredSystem` to replace them without flattening that metadata.

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a project assistant.",
  resolveRuntimeState: async ({ step }) => {
    if (step === 0) return;

    return {
      system: "Use the latest project instructions before continuing.",
    };
  },
});
```

## Agent configuration

| Property                 | Type                                                                                                   | Description                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | `string`                                                                                               | Unique identifier used with `getAgent()`                                                                                                    |
| `name`                   | `string`                                                                                               | Human-readable display name for listings                                                                                                    |
| `description`            | `string`                                                                                               | Optional summary for listings                                                                                                               |
| `model`                  | `string`                                                                                               | Optional provider/model override. Omit for the [inference-path default](./providers.md); use `"auto"` for runtime selection.                |
| `system`                 | `AgentSystem \| () => AgentSystem \| Promise<AgentSystem>`                                             | Text or structured system instructions                                                                                                      |
| `resolveRuntimeState`    | `(request: RuntimeStateRequest) => ResolvedRuntimeState \| Promise<ResolvedRuntimeState \| undefined>` | Refresh system/context before later model steps in the same run                                                                             |
| `tools`                  | `true \| Record<string, boolean \| Tool>`                                                              | Omit for no project tools, use `true` for deferred scoped discovery, or select eager tools explicitly                                       |
| `delegates`              | `string[]`                                                                                             | Exact agent ids exposed as scoped `agent_<id>` tools                                                                                        |
| `providerTools`          | `string[]`                                                                                             | Provider-executed tools such as `web_search`                                                                                                |
| `mcpServers`             | `AgentMcpServerConfig[]`                                                                               | Remote MCP-compatible tool servers                                                                                                          |
| `skills`                 | `true \| string[]`                                                                                     | Advertise all visible skills (`true` or omitted), selected IDs, or none (`[]`)                                                              |
| `bootstrapTools`         | `string[]`                                                                                             | Up to 16 exact authorized tool names exposed immediately in deferred mode                                                                   |
| `optionalBootstrapTools` | `string[]`                                                                                             | Up to 16 exact tool names exposed initially only when already authorized and provider capacity permits; missing or denied tools are skipped |
| `bootstrapSkill`         | `string`                                                                                               | One authorized skill whose root loads before the first model call                                                                           |
| `outputSchema`           | `Schema<T> \| JsonSchema`                                                                              | Constrain responses to a schema and expose the parsed value as `response.data` (`response.object` remains an alias)                         |
| `temperature`            | `number`                                                                                               | Sampling temperature for model generation (default: `0`)                                                                                    |
| `maxSteps`               | `number`                                                                                               | Max tool-call iterations per request                                                                                                        |
| `parallelToolCalls`      | `boolean`                                                                                              | Optional provider tool-call batching control; omission preserves the provider default                                                       |
| `memory`                 | `MemoryConfig`                                                                                         | Conversation memory settings                                                                                                                |
| `streaming`              | `boolean`                                                                                              | Enable streaming (default: `true`)                                                                                                          |
| `middleware`             | `AgentMiddleware[]`                                                                                    | Execution middleware                                                                                                                        |
| `allowedModels`          | `string[]`                                                                                             | Restrict runtime model overrides to these `provider/model` strings                                                                          |

Each agent middleware invocation receives a single-use `next()` continuation.
Its lifecycle is:

- Call `next()` at most once while the middleware is active.
- The continuation becomes invalid when that middleware's returned promise
  settles. Calling it again or after settlement rejects with the registered
  `middleware-error`.
- If you call `next()` after the middleware function returns, downstream
  dispatch starts on the next microtask so settlement revocation wins races
  with an already-fulfilled middleware promise.
- If you intentionally detach that promise, attach its rejection handler in
  the same turn or a microtask; detached-failure reporting runs on the next
  macrotask after that grace window.
- Handlers attached after the macrotask grace window will not suppress the
  report. Synchronous throws also settle the middleware invocation and revoke
  its continuation.
- Direct self-resolution of a continuation is rejected with `TypeError`.
  Indirect promise-adoption cycles are outside this middleware contract and are
  not diagnosed by the chain.
- Re-entrant `next()` calls made by Promise species or other framework-internal
  result-observation hooks are rejected; they are not middleware-body calls.

Middleware can replace or edit messages, but changing a platform control result
removes its trusted ownership. Internal clones preserve that ownership only when
the tool call ID, tool name, `providerExecuted` and data-only result still match the original result.
Caller-supplied result shapes never grant platform control authority.

Child handoffs retain copied tool telemetry when the complete result fits the JSON
resource limits. If telemetry exceeds those limits, the handoff replaces telemetry
values with explicit truncation markers. If the trace entries still exceed the
limits, `toolTelemetryOmitted` reports the number of omitted calls and results
when that metadata fits. Otherwise, the handoff retains the admitted response
without copied telemetry; raw child events retain the full trace.
The accepted child response and raw child events remain unchanged. An oversized
accepted response does not gain trusted ownership by dropping telemetry.

For hosted replay, set `serverResolvedTrustedHostedHistoryMessageIds` only after
matching the replayed platform result contents against immutable canonical run or
input-response evidence, or an original host-authored content digest retained
before edits. Mutable row IDs, roles, senders, tool names and editable parts alone
do not prove origin. Edited replacements lose the grant. Deploy compatible API
and Studio support and qualify replay against that deployed combination before
claiming trusted replay acceptance.

## Verify it worked

Save the agent file and restart `veryfront dev`. The quickest server-side
check is a throwaway debug route:

```ts
// app/api/debug/agent/route.ts
import { getAgent } from "veryfront/agent";

export async function GET() {
  const agent = getAgent("assistant");
  if (!agent) throw new Error("Agent not found: assistant");

  const result = await agent.generate({ input: "Hello" });
  return Response.json({ text: result.text });
}
```

```bash
curl http://localhost:3000/api/debug/agent
```

The response carries the model's reply. Remove the debug route before
deploying.

If generation fails, check the dev-server log for agent registration or provider
errors. If AG-UI routing fails, use the route verification in
[Create agent](../getting-started/create-agent.md). A healthy AG-UI stream ends
with a `RunFinished` event.
