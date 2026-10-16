import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

const getSequenceSchema = defineSchema((v) =>
  v.object({
    sessionId: v.string().uuid().transform((value) => value.toLowerCase()),
    ordinal: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict()
);

export type ToolResultSequence = InferSchema<ReturnType<typeof getSequenceSchema>>;

type Scope = {
  sessionId: string;
  ordinal: number;
  rootController?: ReadableStreamDefaultController;
};
const active = createPrivateAsyncLocalStorage<Scope>();
const resultChunks = createPrivateWeakStore<ChatUiMessageChunk, ToolResultSequence>();
const syntheticRecoveryChunks = createPrivateWeakStore<ChatUiMessageChunk, true>();

/** Executor runtime scope. Only the hosted framework enters this scope. */
export function runWithToolResultSequence<T>(sessionId: string, operation: () => T): T {
  const parsed = getSequenceSchema().parse({ sessionId, ordinal: 0 });
  return active.run({ sessionId: parsed.sessionId, ordinal: 0 }, operation);
}

/** The exact producer position preceding a managed model dispatch. */
export function currentToolResultSequence(): ToolResultSequence | undefined {
  const scope = active.getStore();
  return scope && { sessionId: scope.sessionId, ordinal: scope.ordinal };
}

/** Bind the first runtime message stream, excluding nested agent streams in tools. */
export function observeToolResultSequenceStream(
  controller: ReadableStreamDefaultController,
  type: unknown,
): void {
  const scope = active.getStore();
  if (scope && type === "message-start" && !scope.rootController) {
    scope.rootController = controller;
  }
}

/** Called only after the runtime has successfully enqueued a terminal result. */
export function nextToolResultSequence(
  controller: ReadableStreamDefaultController,
): ToolResultSequence | undefined {
  const scope = active.getStore();
  if (!scope || scope.rootController !== controller) return undefined;
  if (scope.ordinal === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("Managed tool result sequence exhausted");
  }
  return { sessionId: scope.sessionId, ordinal: scope.ordinal + 1 };
}

/** Commit the ordinal previously prepared by the same producer scope. */
export function commitToolResultSequence(sequence: ToolResultSequence): void {
  const scope = active.getStore();
  if (!scope || sequence.sessionId !== scope.sessionId || sequence.ordinal !== scope.ordinal + 1) {
    throw new TypeError("Managed tool result sequence changed during enqueue");
  }
  scope.ordinal = sequence.ordinal;
}

/** Private sidecar on the UI chunk; never enters browser events or project JSON. */
export function bindToolResultSequence(
  chunk: ChatUiMessageChunk,
  sequence: ToolResultSequence,
): void {
  resultChunks.set(chunk, getSequenceSchema().parse(sequence));
}

/** Read a trusted position without serializing it into the UI chunk. */
export function getToolResultSequence(chunk: ChatUiMessageChunk): ToolResultSequence | undefined {
  return resultChunks.get(chunk);
}

/** Mark a converter-only orphan diagnostic emitted after its source stream ended. */
export function bindSyntheticToolResultRecovery(chunk: ChatUiMessageChunk): void {
  syntheticRecoveryChunks.set(chunk, true);
}

/** Distinguish UI recovery from a producer result that can precede another model call. */
export function isSyntheticToolResultRecovery(chunk: ChatUiMessageChunk): boolean {
  return syntheticRecoveryChunks.get(chunk) === true;
}

/** Strict private transport contract shared by model RPCs and streamed results. */
export { getSequenceSchema as getToolResultSequenceSchema };
