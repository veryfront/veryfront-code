import { estimateTokens } from "../../chat/message-prep.ts";
import { AGENT_CONTEXT_WINDOW_EXCEEDED } from "#veryfront/errors";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;

function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? getOwnDescriptor(value, key)?.value
    : undefined;
}

function hasNativeMedia(messages: readonly unknown[]): boolean {
  for (let index = 0; index < messages.length; index++) {
    const message = own(messages, String(index));
    if (own(message, "role") !== "user") continue;
    const content = own(message, "content");
    if (!isArray(content)) continue;
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      const type = own(own(content, String(partIndex)), "type");
      if (type === "image" || type === "file") return true;
    }
  }
  return false;
}

/** Token ceilings the served model deployment declares. */
export type ServedRequestLimit = { readonly context?: number; readonly output?: number };

/** Inputs for estimating one assembled provider request. */
export type FinalRequestBudgetInput = {
  system: unknown;
  messages: readonly unknown[];
  tools?: Record<string, unknown>;
  responseFormat?: unknown;
  limit?: ServedRequestLimit;
  requestedOutputTokens: number;
  explicitOutputTokens?: boolean;
};

/** Result of measuring one assembled request against the served limits. */
export type FinalRequestBudgetInspection = {
  maxOutputTokens: number;
  estimatedInputTokens: number | null;
  fits: boolean;
  outputExceeded: boolean;
};

/** Reject an assembled request that cannot fit the served limits before it is dispatched. */
export function enforceFinalRequestBudget(
  input: FinalRequestBudgetInput,
): { maxOutputTokens: number; estimatedInputTokens: number | null } {
  const estimate = inspectFinalRequestBudget(input);
  if (estimate.outputExceeded) {
    throw AGENT_CONTEXT_WINDOW_EXCEEDED.create({
      detail:
        `Requested output ${input.requestedOutputTokens} exceeds the served output limit ${input.limit?.output}`,
    });
  }
  if (!estimate.fits) {
    throw AGENT_CONTEXT_WINDOW_EXCEEDED.create({
      detail:
        `Estimated final request of ${estimate.estimatedInputTokens} input tokens plus ${estimate.maxOutputTokens} output tokens exceeds the served context window ${input.limit?.context}`,
    });
  }
  return {
    maxOutputTokens: estimate.maxOutputTokens,
    estimatedInputTokens: estimate.estimatedInputTokens,
  };
}

/** Best-effort estimate of the assembled request, before provider-specific framing. */
export function inspectFinalRequestBudget(
  input: FinalRequestBudgetInput,
): FinalRequestBudgetInspection {
  const outputLimit = input.limit?.output;
  const outputExceeded = input.explicitOutputTokens === true && outputLimit !== undefined &&
    input.requestedOutputTokens > outputLimit;
  const maxOutputTokens = outputLimit === undefined
    ? input.requestedOutputTokens
    : Math.min(input.requestedOutputTokens, outputLimit);
  // Native media cost depends on the provider's media tokenizer. Encoded bytes
  // cannot be estimated as text; keep the input cost unknown, as for a missing limit.
  if (input.limit?.context === undefined || hasNativeMedia(input.messages)) {
    return { maxOutputTokens, estimatedInputTokens: null, fits: true, outputExceeded };
  }
  const toolSchemas = Object.entries(input.tools ?? {}).map(([name, value]) => {
    const definition = value as Record<string, unknown> | null;
    if (!definition || typeof definition !== "object") return { name, definition };
    // Provider-native tools send their provider id and arguments, not the
    // framework's lazy validation schema.
    if (definition.type === "provider") {
      return { name, type: "provider", id: definition.id, args: definition.args };
    }
    const schema = definition.inputSchema;
    const schemaObject = typeof schema === "function" ? schema() : schema;
    const inputSchema = schemaObject && typeof schemaObject === "object" &&
        "jsonSchema" in schemaObject
      ? schemaObject.jsonSchema
      : schemaObject;
    return {
      name,
      type: definition.type,
      id: definition.id,
      args: definition.args,
      description: definition.description,
      inputSchema,
    };
  });
  const rawInputTokens = estimateTokens(input.system) +
    estimateTokens(input.messages) + estimateTokens(toolSchemas) +
    (input.responseFormat === undefined ? 0 : estimateTokens(input.responseFormat));
  // This heuristic margin is not a tokenizer upper bound: Unicode, media and
  // provider-specific framing can use more tokens than this estimate.
  const estimatedInputTokens = Math.ceil(rawInputTokens * 1.1) + 16;
  return {
    maxOutputTokens,
    estimatedInputTokens,
    fits: estimatedInputTokens + maxOutputTokens <= input.limit.context,
    outputExceeded,
  };
}
