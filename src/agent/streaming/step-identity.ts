import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

type StepStartChunk = Extract<ChatUiMessageChunk<ChatMessageMetadata>, { type: "start-step" }>;

const stepIds = new WeakMap<object, string>();
/** @internal Read the private projection identity without trusting public fields. */
export const getStepIdentity = stepIds.get.bind(stepIds);
const storeStepId = stepIds.set.bind(stepIds);

/**
 * @internal Share one formatting identity across projections of this occurrence.
 * A validated runtime observation owns producerStepId when supplied. This
 * binding does not prove execution or authorize a durable runtime observation.
 */
export function createMirroredStepChunk(
  chunk: StepStartChunk,
  producerStepId?: string,
): StepStartChunk {
  const prepared = { ...chunk };
  storeStepId(prepared, producerStepId ?? crypto.randomUUID());
  return prepared;
}

/** @internal Keep a projection identity when normalizing the same occurrence. */
export function retainStepIdentity<T extends object>(source: StepStartChunk, target: T): T {
  const stepId = getStepIdentity(source);
  if (stepId !== undefined) storeStepId(target, stepId);
  return target;
}
