import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

type StepStartChunk = Extract<ChatUiMessageChunk<ChatMessageMetadata>, { type: "start-step" }>;

const stepIds = new WeakMap<object, string>();
const readStepId = stepIds.get.bind(stepIds);
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

/** @internal Read the private projection identity without trusting public fields. */
export function getStepIdentity(chunk: object): string | undefined {
  return readStepId(chunk);
}

/** @internal Keep a projection identity when normalizing the same occurrence. */
export function retainStepIdentity<T extends object>(source: object, target: T): T {
  const stepId = readStepId(source);
  if (stepId !== undefined) storeStepId(target, stepId);
  return target;
}
