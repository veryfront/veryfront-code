# Agent message stream dataflow

This page explains how a Veryfront agent run turns a conversation prompt into
provider requests, streamed parts, tool calls, child runs, and durable replay
state. The point is to make the runtime mental model explicit: models do not get
hidden access to prior provider state. Each step is reconstructed from the
messages, tools, run state, and provider replay metadata that Veryfront sends.

## Responsibility

Message stream dataflow spans four boundaries:

- [`src/chat/`](../../src/chat/) owns canonical message parts, conversation
  conversion, AG-UI-compatible chunks, and browser stream assembly.
- [`src/agent/runtime/`](../../src/agent/runtime/) owns provider-neutral agent
  execution, stream state, local tool execution, and final assistant message
  materialization.
- [`src/agent/hosted/`](../../src/agent/hosted/) owns hosted conversation runs,
  child-run fork inputs, durable run state, and cloud runtime adaptation.
- [`extensions/ext-llm-*`](../../extensions/) owns provider-specific request
  shaping and provider-specific stream parsing.

The API service persists hosted conversation and run state. Veryfront Code owns
the runtime contracts that decide which parts exist and how they are replayed.

## Prompt state

A model request is built from explicit state:

1. The current system instructions and runtime options.
2. Conversation messages normalized into provider-model messages.
3. Tool definitions visible to the selected model.
4. Provider options such as reasoning, cache, native tools, and metadata.
5. Durable child-run or hosted-run context when the run is hosted.

The provider is not expected to remember prior turns outside this request. Even
long-running streams are treated as a sequence of model turns. When a tool call
interrupts assistant text, the runtime commits the tool call, runs the tool, and
then sends a new provider request containing the assistant tool call and the
tool result needed for the model to continue.

## End to end sequence

The normal hosted chat path is:

1. The browser or host submits a prompt and selected agent options.
2. Hosted runtime code resolves the model, temperature, max steps, thinking,
   cloud gateway transport, and provider options.
3. Agent runtime converts the conversation into provider-model messages and
   converts visible tools into runtime tool definitions.
4. `generateText` or `streamText` calls the provider runtime with model,
   system, messages, tools, max output tokens, temperature, headers, and
   provider options.
5. The provider extension builds the native request body for Anthropic,
   OpenAI-compatible, Google, or Kimi-compatible APIs.
6. Provider stream frames are parsed into provider-neutral runtime parts.
7. The runtime stream handler turns those parts into chat stream chunks and
   updates in-memory text, reasoning, tool, usage, and finish accumulators.
8. The browser stream assembler turns chunks into ordered UI message parts.
9. At step end, the runtime materializes one assistant message and durable
   replay metadata from the accumulators.
10. If a local tool call was committed, the tool result is appended and the
    next provider request is built from the updated explicit transcript.

There is no hidden provider session in this flow. Continuity comes from the
messages and provider replay metadata Veryfront sends on each model call.

## Runtime option resolution

Default runtime values are intentionally deterministic. `AGENT_DEFAULTS` sets
temperature to `0`, `DEFAULT_TEMPERATURE` re-exports that value, and
`AgentRuntime.resolveTemperature()` falls back to it when an agent does not set
`temperature`.

Hosted runs keep that rule. `src/agent/hosted/runtime-request-config.ts` takes
temperature from the agent config, not from the transient run request, and
`src/agent/hosted/default-chat-runtime.ts` passes it into the runtime config.

Veryfront Cloud Anthropic thinking is the important exception. Anthropic
extended thinking requests are built through provider options that include
`thinking: { type: "enabled", budget_tokens: N }` and `temperature: 1`. The
Anthropic request builder drops normal sampling parameters when thinking is
enabled, then applies provider options. That means the general Veryfront default
is still `0`, but Anthropic thinking requests intentionally run with
`temperature: 1` for provider compatibility. If a caller needs strict
temperature `0` on Anthropic, thinking must be disabled for that request.

## Stream shape

Provider adapters translate provider-specific streaming frames into
provider-neutral runtime parts:

- `reasoning-start`, `reasoning-delta`, `reasoning-end`
- `text-start`, `text-delta`, `text-end`
- `tool-input-start`, `tool-input-delta`, `tool-input-available`
- `tool-call`
- `tool-result` or provider-executed tool result parts
- `finish` with finish reason and usage

The runtime stream handler keeps separate in-memory accumulators for text,
reasoning, local tool input, provider-executed tool calls, usage, and finish
reason. This separation matters because the model may stream partial JSON tool
arguments, interrupt text with a tool call, or emit provider-native tool
activity that should be visible in the UI but not executed locally.

## Assistant message materialization

At the end of a model step, the runtime writes one assistant message from the
accumulated parts:

1. Reasoning parts are materialized first when the provider exposed reasoning.
2. Text parts are materialized next.
3. Tool-call parts are materialized with stable `toolCallId`, `toolName`, and
   parsed input.
4. Provider-executed tool calls and results are preserved as renderable audit
   parts.
5. Usage metadata is attached to the final message metadata.

For Anthropic extended thinking, clear thinking signatures and redacted
thinking payloads are preserved on reasoning parts. Those fields are replay
metadata, not display text. They let the next Anthropic request include valid
thinking history instead of losing provider-required state between turns.

## Tool calls

Local tools and provider-native tools have different ownership.

Local tools are executed by the Veryfront runtime:

1. The provider streams a tool input.
2. The runtime parses and validates the input.
3. The runtime executes the local tool.
4. The tool result becomes an explicit role `tool` message for the next model
   step.

Provider-native tools are executed by the provider:

1. Veryfront includes the provider-native tool declaration in the provider
   request.
2. The provider streams tool activity and results.
3. Veryfront records those parts for visibility and replay where the provider
   supports it.
4. Veryfront does not run a local tool with the same name unless the part is a
   local tool call.

This keeps web search, web fetch, code execution, and similar provider tools
visible without conflating them with project-defined tools.

## Message part taxonomy

The chat layer carries two related part shapes:

- Provider model parts are the replayable prompt facts sent back to model
  providers. They include text, reasoning with signatures or redacted data,
  tool calls, tool results, and provider options.
- UI parts are renderable browser state. They include text, reasoning, source
  parts, data parts, dynamic tool parts, and named tool parts with lifecycle
  states such as pending, input streaming, input available, output available,
  output error, and output denied.

The stream handler bridges those shapes. It can emit partial UI chunks while a
provider streams JSON tool input, then materialize a stable replay part only
when the tool input is complete enough to commit.

## Child agent runs

`invoke_agent` creates an isolated child run. The child receives its own
conversation context and tool inventory. The parent transcript receives a compact
summary/result and durable child-run identifiers, not the full child transcript.

When the parent needs the child to act on critical facts from prior tool
results, it should pass generic `context`. This is the child execution payload:
records, ids, decisions, and other structured values the child must preserve.
The prompt explains the task, but `context` carries the data to act on.

The hosted child input does not accept a separate evidence reference payload.
Critical facts must be copied into `context`; durable child-run ids, parent tool
calls, and child summaries provide the audit trail. The child prompt receives
the `structured_context` block and is instructed to prefer it when prose
conflicts with it.

Child run events should remain inspectable and streamable through child-run
views. They should not be dumped into the parent context, because that would
inflate replay cost and make the parent responsible for another agent's full
trajectory.

## Browser presentation

The browser receives canonical chat UI chunks. The React stream handler assembles
those chunks into ordered message parts:

- Partial text and reasoning parts are shown while streaming.
- Tool input and output lifecycle states are updated in place.
- Provider-native tool activity can be rendered as expandable audit parts.
- Final message parts replace only the matching streamed part, not unrelated
  visible text.

Reasoning replay metadata can travel through `reasoning-end` and
`reasoning` parts. UI components should treat that metadata as non-display
state unless they intentionally expose a diagnostic view.

## Replay and compaction

Replay prepares historical conversation state for the next request. It can
remove stale or overly large historical tool outputs, but it must keep the
latest unresolved tool round coherent: assistant tool calls must be followed by
matching tool results. Provider-specific replay rules also apply, such as
Anthropic thinking signatures for thinking blocks.

Compaction should summarize old context into an explicit message or event and
then replay that summary as ordinary prompt state. It should not rely on hidden
provider memory. Attachments with large binary payloads should be represented by
stable references or summaries rather than repeated inline data.

## Veryfront Cloud model catalog audit

The local catalog is in
[`src/provider/veryfront-cloud/model-catalog.ts`](../../src/provider/veryfront-cloud/model-catalog.ts).
The gateway routes are in
[`src/provider/veryfront-cloud/shared.ts`](../../src/provider/veryfront-cloud/shared.ts)
and the provider runtime switch is in
[`src/provider/veryfront-cloud/provider.ts`](../../src/provider/veryfront-cloud/provider.ts).

| Alias                    | Upstream model ID                         | Runtime path                                                 | Verified provider contract                                                                                                                             | Veryfront integration status                                                                                                                                                         |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `opus`                   | `anthropic/claude-opus-4-8`               | Anthropic Messages API through `ai/gateway/anthropic/v1`     | Anthropic lists Opus 4.8 with 128k synchronous max output and adaptive thinking support, but no manual extended thinking support.                      | Catalog does not enable manual thinking for Opus 4.8, so provider options do not force temperature to 1 for this model. Runtime max output cap is 128k.                              |
| `sonnet`                 | `anthropic/claude-sonnet-4-6`             | Anthropic Messages API through `ai/gateway/anthropic/v1`     | Anthropic lists Sonnet 4.6 with 64k synchronous max output and manual extended thinking still functional but deprecated in favor of adaptive thinking. | Catalog enables manual thinking with 2048 budget tokens and provider options set temperature to 1. Runtime and Anthropic request caps are 64k.                                       |
| `haiku`                  | `anthropic/claude-haiku-4-5-20251001`     | Anthropic Messages API through `ai/gateway/anthropic/v1`     | Anthropic lists Haiku 4.5 with 64k synchronous max output and extended thinking support.                                                               | Catalog enables manual thinking with 1024 budget tokens. Runtime max output cap is 64k.                                                                                              |
| `gpt-5.5`                | `openai/gpt-5.5`                          | OpenAI-compatible runtime through `ai/gateway/openai/v1`     | OpenAI documents GPT-5.5 as the latest GPT-5 family target for API requests.                                                                           | Catalog routes through the OpenAI runtime. Runtime max output cap is 128k.                                                                                                           |
| `gemini-3.1-pro-preview` | `google-ai-studio/gemini-3.1-pro-preview` | Google runtime through `ai/gateway/google/v1beta`            | Google lists Gemini 3.1 Pro Preview in the Gemini API model catalog.                                                                                   | Catalog aliases `gemini-3.1-pro` to the preview provider ID and maps `google-ai-studio` to the Google provider. Runtime max output cap is 65,536.                                    |
| `gemini-3.5-flash`       | `google-ai-studio/gemini-3.5-flash`       | Google runtime through `ai/gateway/google/v1beta`            | Google lists Gemini 3.5 Flash in the Gemini API model catalog.                                                                                         | Catalog aliases `google-ai-studio` to the Google provider. Runtime max output cap is 65,536.                                                                                         |
| `kimi-k2.6`              | `moonshotai/kimi-k2.6`                    | OpenAI-compatible runtime through `ai/gateway/moonshotai/v1` | Kimi documents Kimi K2.6 as the current model code for OpenAI-compatible chat completions, streaming, and tool use.                                    | Catalog routes Moonshot through the OpenAI runtime. Runtime capability detection normalizes Kimi K2.6 requests to temperature 1 for thinking mode and 0.6 when thinking is disabled. |

The audit found and fixed two local integration drift issues:

- Runtime default max output caps track the current catalog entries and keep
  legacy direct model IDs for saved configurations.
- Anthropic default thinking is catalog-driven: Sonnet 4.6 and Haiku 4.5 keep
  manual thinking budgets, while Opus 4.8 uses adaptive thinking and does not
  force `temperature: 1`.

## Provider integration notes

OpenAI and Moonshot use OpenAI-compatible request and stream shapes. Local
function tools become OpenAI-style tools, streamed tool calls become runtime
tool input chunks, and tool outputs are replayed as explicit tool messages.
OpenAI Responses support can preserve reasoning-specific provider metadata when
that runtime is selected.

Anthropic uses Messages API request and stream shapes. Text, thinking,
redacted thinking, `tool_use`, and `tool_result` blocks are converted into
Veryfront model and UI parts. Thinking signatures and redacted payloads are
replay metadata and must not be dropped during compaction.

Google uses `generateContent` and `streamGenerateContent` shapes. Local tools
are mapped to `functionDeclarations`, model function calls are returned to the
runtime as tool input parts, and tool outputs are replayed as
`functionResponse` parts on the following request.

Provider-native tools are only native when their IDs use a provider prefix such
as `openai.*`, `anthropic.*`, or `google.*`. Unprefixed project tools remain
local Veryfront tools.

## Failure model

Technical failures and business failures are different runtime facts.

- A technical failure means the runtime, provider, transport, or tool execution
  could not complete the requested operation. It should become terminal run
  error state and user-facing retry guidance.
- A business failure means the agent completed the operation and found a domain
  outcome such as validation failure, policy rejection, missing evidence, or
  mismatched data. It should be represented as ordinary assistant output or a
  structured tool result, not as a transport error.

This distinction lets the run be observable without treating every undesirable
domain outcome as an infrastructure failure.

## Change checks

- Run provider-specific tests when changing request builders or stream parsers.
- Run agent runtime stream tests when changing runtime parts or tool lifecycle
  handling.
- Run chat stream assembly tests when changing UI chunks or client message
  materialization.
- Run hosted child-run tests when changing `invoke_agent` or child fork inputs.
- Verify that provider replay metadata remains non-display state but survives
  request replay.
- Re-check provider model catalogs before changing
  `MODEL_MAX_OUTPUT_TOKENS`, provider request builders, or Veryfront Cloud
  model aliases.

## Research sources

- [Anthropic models overview](https://docs.anthropic.com/en/docs/about-claude/models/overview)
- [Anthropic extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [Anthropic tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [OpenAI GPT-5.5 guide](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)
- [Google Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
- [Google function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Kimi models overview](https://platform.kimi.ai/docs/models)
- [Kimi K2.6 quickstart](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart)
- [Kimi OpenAI migration guide](https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi)
