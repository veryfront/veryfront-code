import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import type { Message } from "../types.ts";
import type { RuntimeGenerateTextResult } from "../runtime/runtime-tool-types.ts";
import type { AgUiRuntimeStreamEvent } from "../ag-ui/encoder.ts";
import { parseDataStreamSseEvents } from "../streaming/data-stream.ts";
import {
  closePrivateStream,
  createPrivateReadableStream,
  enqueuePrivateStream,
  errorPrivateStream,
  getPrivateStreamReader,
} from "#veryfront/security/private-stream.ts";
import { createPrivateTextDecoder } from "#veryfront/security/private-text.ts";

export interface LocalChildResult {
  text: string;
  object?: unknown;
  toolCalls: number;
  status: string;
}

export interface LocalChildInvocation {
  agentId: string;
  input: string;
  toolName: string;
  toolInput: unknown;
  context?: ToolExecutionContext;
  execute: (control?: {
    signal?: AbortSignal;
    onEvent?: (event: AgUiRuntimeStreamEvent) => Promise<void>;
  }) => Promise<LocalChildResult>;
}

type Scope = {
  active: boolean;
  runtime?: AgentRuntime;
  execute: (input: LocalChildInvocation) => Promise<LocalChildResult>;
  observe?: (event: AgUiRuntimeStreamEvent) => Promise<void>;
  createObserver?: () => NonNullable<Scope["observe"]>;
  automaticStreamObservation?: boolean;
  admitTool?: (id: string, name: string, input: unknown) => Promise<void>;
};
const scopes = new AsyncLocalStorage<Scope>();
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;
const apply = Reflect.apply;

/** Private host boundary for the existing local delegation operation. */
export async function withLocalChildExecution<T>(
  execute: Scope["execute"],
  operation: () => Promise<T>,
  observe?: Scope["observe"],
  admitTool?: Scope["admitTool"],
  createObserver?: Scope["createObserver"],
): Promise<T> {
  const scope: Scope = {
    active: true,
    execute,
    observe,
    admitTool,
    createObserver,
    automaticStreamObservation: true,
  };
  try {
    return await (apply(run, scopes, [scope, operation]) as Promise<T>);
  } finally {
    scope.active = false;
  }
}

/**
 * Only the active owning runtime may use a host scope while its turn is on the
 * stack; unrelated nested agents keep local semantics. Once that top-level turn
 * returns, the same task execution may observe another top-level agent runtime.
 */
export function withLocalChildRuntime<T>(runtime: AgentRuntime, operation: () => T): T {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active) return operation();
  if (scope.runtime !== undefined && scope.runtime !== runtime) {
    return apply(run, scopes, [undefined, operation]) as T;
  }
  if (scope.runtime === runtime) return operation();
  const ownedScope: Scope = {
    ...scope,
    get active() {
      return scope.active;
    },
    runtime,
    observe: scope.createObserver?.() ?? scope.observe,
  };
  return apply(run, scopes, [ownedScope, operation]) as T;
}

export function executeLocalChild(input: LocalChildInvocation): Promise<LocalChildResult> {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  return scope?.active ? scope.execute(input) : input.execute();
}

export function withoutAutomaticRuntimeStreamObservation<T>(operation: () => T): T {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active || scope.automaticStreamObservation === false) return operation();
  const disabledScope: Scope = {
    ...scope,
    get active() {
      return scope.active;
    },
    automaticStreamObservation: false,
  };
  return apply(run, scopes, [disabledScope, operation]) as T;
}

export function observeRuntimeStream(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active || scope.automaticStreamObservation === false || !scope.observe) return stream;
  const observe = scope.observe;

  const reader = getPrivateStreamReader(stream);
  const decoder = createPrivateTextDecoder();
  let remainder = "";
  let released = false;
  const releaseReader = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const observeChunk = async (chunk: Uint8Array | undefined): Promise<void> => {
    remainder += decoder.decode(chunk, { stream: chunk !== undefined });
    const parsed = parseDataStreamSseEvents(chunk === undefined ? `${remainder}\n\n` : remainder);
    remainder = parsed.remainder;
    for (const event of parsed.events) await observe(event);
  };

  return createPrivateReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            await observeChunk(undefined);
            releaseReader();
            closePrivateStream(controller);
            return;
          }
          await observeChunk(next.value);
          enqueuePrivateStream(controller, next.value);
        } catch (error) {
          try {
            await reader.cancel(error);
          } catch {
            // The observer failure remains the useful error for callers.
          }
          releaseReader();
          errorPrivateStream(controller, error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          releaseReader();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

/** Observe accepted nonstreaming provider turns through the same private host mirror. */
export async function observeGeneratedAgentTurn(
  messageId: string,
  turn: RuntimeGenerateTextResult,
): Promise<void> {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active || !scope.observe) return;
  const observe = scope.observe;
  await observe({ type: "message-start", messageId });
  if (turn.reasoning) {
    const id = `${messageId}:reasoning`;
    await observe({ type: "reasoning-start", id });
    await observe({ type: "reasoning-delta", id, delta: turn.reasoning });
    await observe({ type: "reasoning-end", id });
  }
  if (turn.text) {
    const id = `${messageId}:text`;
    await observe({ type: "text-start", id, messageId });
    await observe({ type: "text-delta", id, messageId, delta: turn.text });
    await observe({ type: "text-end", id, messageId });
  }
  for (const call of turn.toolCalls ?? []) {
    await scope.admitTool?.(call.toolCallId, call.toolName, call.input);
    await observe({
      type: "tool-input-start",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
    });
    await observe({
      type: "tool-input-available",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    });
  }
}

/** Observe only committed tool outcomes, never credentials or provider metadata. */
export async function observeGeneratedAgentMessage(message: Message): Promise<void> {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active || !scope.observe || message.role !== "tool") return;
  for (const part of message.parts) {
    if (part.type === "tool-result" && "result" in part) {
      await scope.observe({
        type: "tool-output-available",
        toolCallId: part.toolCallId,
        output: part.result,
      });
    }
  }
}

/** Bind streamed local delegation to the accepted provider tool turn before executing it. */
export async function observeAdmittedAgentToolCalls(message: Message): Promise<void> {
  const scope: Scope | undefined = apply(getStore, scopes, []);
  if (!scope?.active || !scope.observe || message.role !== "assistant") return;
  for (const part of message.parts) {
    if ("toolCallId" in part && "toolName" in part && "args" in part) {
      await scope.admitTool?.(part.toolCallId, part.toolName, part.args);
    }
  }
}
