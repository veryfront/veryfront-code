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

## Child agent runs

`invoke_agent` creates an isolated child run. The child receives its own
conversation context and tool inventory. The parent transcript receives a compact
summary/result and durable child-run identifiers, not the full child transcript.

When the parent needs the child to use structured facts from prior tool results,
it can pass generic `evidence_refs`. These refs point to prior run/message/tool
evidence and are appended to the child prompt as structured context. They are
also stored in child-run metadata. This avoids asking the parent model to
rewrite critical facts as prose and lets the child prefer referenced evidence
when prose conflicts with the refs.

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
