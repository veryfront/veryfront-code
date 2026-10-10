import {
  getProviderModelMessageSourceId,
  withProviderModelMessageSourceId,
} from "./conversation.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  concatPrivateArrays,
  forEachPrivateArray,
  pushPrivateArray,
} from "#veryfront/security/private-array.ts";
import type { ChatToolResultPart, ProviderModelMessage } from "./types.ts";
import type { ToolResultPart } from "#veryfront/agent/types.ts";

type ResultPart = ChatToolResultPart | ToolResultPart;
const sources = createPrivateWeakStore<ResultPart, string>();

/** @internal Bind projected tool results to their original UI source. */
export function markToolResultSources(
  parts: readonly ChatToolResultPart[],
  sourceId: string,
): void {
  forEachPrivateArray(parts, (part) => sources.set(part, sourceId));
}

/** @internal Preserve opaque source identity when a result is projected or masked. */
export function inheritToolResultSource<T extends ResultPart>(source: ResultPart, target: T): T {
  const sourceId = sources.get(source);
  if (sourceId !== undefined) sources.set(target, sourceId);
  return target;
}

/** @internal Read original identity without trusting plain fields or container IDs. */
export function getToolResultSource(part: ResultPart): string | undefined {
  return sources.get(part);
}

/** @internal Append a projection while keeping each result's opaque original identity. */
export function appendSourceProjection(
  messages: ProviderModelMessage[],
  projected: ProviderModelMessage,
  sourceId: string,
): void {
  if (projected.role === "tool") markToolResultSources(projected.content, sourceId);
  const message = withProviderModelMessageSourceId(projected, sourceId);
  const previous = messages[messages.length - 1];
  if (previous?.role === "tool" && message.role === "tool") {
    messages[messages.length - 1] = withProviderModelMessageSourceId({
      role: "tool",
      content: concatPrivateArrays(previous.content, message.content),
    }, getProviderModelMessageSourceId(previous) ?? sourceId);
  } else {
    pushPrivateArray(messages, message);
  }
}
