import { estimateTokens } from "../../chat/message-prep.ts";
import { AGENT_CONTEXT_WINDOW_EXCEEDED } from "#veryfront/errors";
import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;

function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? getOwnDescriptor(value, key)?.value
    : undefined;
}

/**
 * Replace native user media with its part type. Media cost depends on the
 * provider's media tokenizer and encoded bytes cannot be estimated as text,
 * so the remaining request is a lower bound on the input cost.
 */
function withoutNativeMediaPayloads(
  messages: readonly unknown[],
): { messages: readonly unknown[]; hasMedia: boolean } {
  let hasMedia = false;
  const measured: unknown[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = own(messages, String(index));
    const content = own(message, "content");
    if (own(message, "role") !== "user" || !isArray(content)) {
      measured.push(message);
      continue;
    }
    const parts: unknown[] = [];
    let replaced = false;
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      const part = own(content, String(partIndex));
      const type = own(part, "type");
      if (type === "image" || type === "file") {
        parts.push({ type });
        replaced = true;
      } else {
        parts.push(part);
      }
    }
    hasMedia ||= replaced;
    measured.push(replaced ? { role: "user", content: parts } : message);
  }
  return { messages: hasMedia ? measured : messages, hasMedia };
}

/**
 * Output room an implicit request must keep. Without a caller override the
 * requested output is the model's maximum (for example 64k), which is a
 * ceiling, not a need: reserving all of it rejects inputs that fit the window
 * with ample room to answer.
 */
export const MIN_IMPLICIT_OUTPUT_TOKENS = 4_096;

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
  /** Tokens the provider adds on top of the output request, such as a thinking budget. */
  additionalOutputTokens?: number;
};

/** Result of measuring one assembled request against the served limits. */
export type FinalRequestBudgetInspection = {
  /** False when native media makes `estimatedInputTokens` a lower bound. */
  inputCostKnown: boolean;
  /** Output tokens to send: the requested output, capped to the served limits. */
  maxOutputTokens: number;
  /** Output tokens the request must keep free in the context window. */
  reservedOutputTokens: number;
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
      detail: `Estimated final request of ${
        estimate.inputCostKnown ? "" : "at least "
      }${estimate.estimatedInputTokens} input tokens plus ${
        estimate.reservedOutputTokens + (input.additionalOutputTokens ?? 0)
      } output tokens exceeds the served context window ${input.limit?.context}`,
    });
  }
  return {
    maxOutputTokens: estimate.maxOutputTokens,
    estimatedInputTokens: estimate.inputCostKnown ? estimate.estimatedInputTokens : null,
  };
}

/**
 * Enforce the budget, then re-check it against the effective wire request.
 * Native provider controls (for example `providerOptions.anthropic.max_tokens`
 * or a native response format) replace the neutral values on the wire, so a
 * request that fits only under the neutral values is still rejected.
 */
export function enforceProviderRequestBudget(
  input: FinalRequestBudgetInput & {
    model: Parameters<typeof buildModelCallContextRequest>[0];
    reasoning?: unknown;
    providerOptions?: unknown;
  },
): { maxOutputTokens: number; estimatedInputTokens: number | null } {
  const { model, reasoning, providerOptions, ...budget } = input;
  const result = enforceFinalRequestBudget(budget);
  if (budget.limit === undefined) return result;
  const effective = buildModelCallContextRequest(
    model,
    {
      maxOutputTokens: result.maxOutputTokens,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(providerOptions === undefined ? {} : { providerOptions }),
      ...(budget.responseFormat === undefined ? {} : { responseFormat: budget.responseFormat }),
    } as Parameters<typeof buildModelCallContextRequest>[1],
  );
  const additional = budget.additionalOutputTokens ?? 0;
  const wireOutput = effective?.maxOutputTokens;
  const nativeOutput = wireOutput !== undefined && wireOutput !== result.maxOutputTokens &&
    wireOutput !== result.maxOutputTokens + additional;
  const nativeFormat = budget.responseFormat === undefined &&
    effective?.responseFormat !== undefined;
  if (!nativeOutput && !nativeFormat) return result;
  enforceFinalRequestBudget({
    ...budget,
    responseFormat: budget.responseFormat ?? effective?.responseFormat,
    requestedOutputTokens: nativeOutput ? wireOutput : result.maxOutputTokens,
    explicitOutputTokens: true,
    additionalOutputTokens: nativeOutput ? 0 : additional,
  });
  return result;
}

/** Best-effort estimate of the assembled request, before provider-specific framing. */
export function inspectFinalRequestBudget(
  input: FinalRequestBudgetInput,
): FinalRequestBudgetInspection {
  const outputLimit = input.limit?.output;
  const outputExceeded = input.explicitOutputTokens === true && outputLimit !== undefined &&
    input.requestedOutputTokens > outputLimit;
  const cappedOutputTokens = outputLimit === undefined
    ? input.requestedOutputTokens
    : Math.min(input.requestedOutputTokens, outputLimit);
  // An explicit output request is reserved in full. An implicit one defaults to
  // the model maximum, so it reserves only a bounded floor and is then capped to
  // the room the input leaves, as the provider requires input plus output to fit.
  const reservedOutputTokens = input.explicitOutputTokens === true
    ? cappedOutputTokens
    : Math.min(cappedOutputTokens, MIN_IMPLICIT_OUTPUT_TOKENS);
  if (input.limit?.context === undefined) {
    return {
      inputCostKnown: false,
      maxOutputTokens: cappedOutputTokens,
      reservedOutputTokens,
      estimatedInputTokens: null,
      fits: true,
      outputExceeded,
    };
  }
  // With native media the remaining measurable request is still enforced: if
  // it alone cannot fit, the whole request cannot either.
  const measured = withoutNativeMediaPayloads(input.messages);
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
    estimateTokens(measured.messages) + estimateTokens(toolSchemas) +
    (input.responseFormat === undefined ? 0 : estimateTokens(input.responseFormat));
  // This heuristic margin is not a tokenizer upper bound: Unicode, media and
  // provider-specific framing can use more tokens than this estimate.
  const estimatedInputTokens = Math.ceil(rawInputTokens * 1.1) + 16;
  const additionalOutputTokens = input.additionalOutputTokens ?? 0;
  const availableOutputTokens = input.limit.context - estimatedInputTokens -
    additionalOutputTokens;
  return {
    inputCostKnown: !measured.hasMedia,
    maxOutputTokens: input.explicitOutputTokens === true
      ? cappedOutputTokens
      : Math.max(reservedOutputTokens, Math.min(cappedOutputTokens, availableOutputTokens)),
    reservedOutputTokens,
    estimatedInputTokens,
    fits: estimatedInputTokens + reservedOutputTokens + additionalOutputTokens <=
      input.limit.context,
    outputExceeded,
  };
}
