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
      detail: `Requested output ${
        input.requestedOutputTokens + (input.additionalOutputTokens ?? 0)
      } exceeds the served output limit ${input.limit?.output}`,
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

type ModelCallMetadata = Parameters<typeof buildModelCallContextRequest>[0];
type ModelCallSource = Parameters<typeof buildModelCallContextRequest>[1];

/** Tool descriptors the request builder reads to select a provider transport. */
function toolDescriptors(tools: Record<string, unknown> | undefined): unknown[] {
  return Object.entries(tools ?? {}).map(([name, value]) => {
    const definition = value as Record<string, unknown> | null;
    return definition && typeof definition === "object" && definition.type === "provider"
      ? { type: "provider", name, id: definition.id, args: definition.args }
      : { type: "function", name };
  });
}

/**
 * Effective wire request budgeting. Native provider
 * controls replace neutral values on the wire: a native output limit (for
 * example `providerOptions.anthropic.max_tokens` or `max_output_tokens`) is
 * what the provider receives, and a native response format replaces the
 * neutral one. The request builder is probed with two neutral output values:
 * a wire output that does not follow them is a native limit, and one that
 * does reveals the tokens the provider adds on top, such as a thinking budget.
 */
export type ProviderRequestBudgetInput = FinalRequestBudgetInput & {
  model: ModelCallMetadata;
  reasoning?: unknown;
  providerOptions?: unknown;
};

function resolveEffectiveBudget(
  input: ProviderRequestBudgetInput,
): { budget: FinalRequestBudgetInput; nativeOutputTokens?: number } {
  const { model, reasoning, providerOptions, ...budget } = input;
  if (budget.limit === undefined) return { budget };
  const probe = (maxOutputTokens: number) =>
    buildModelCallContextRequest(model, {
      maxOutputTokens,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(providerOptions === undefined ? {} : { providerOptions }),
      ...(budget.responseFormat === undefined ? {} : { responseFormat: budget.responseFormat }),
      tools: toolDescriptors(budget.tools),
    } as ModelCallSource);
  const low = probe(1);
  const high = probe(2);
  const responseFormat = low?.responseFormat ?? budget.responseFormat;
  const lowOutput = low?.maxOutputTokens;
  if (lowOutput !== undefined && lowOutput === high?.maxOutputTokens) {
    // A native output limit is the wire value, so it is reserved in full.
    return {
      budget: {
        ...budget,
        responseFormat,
        requestedOutputTokens: lowOutput,
        explicitOutputTokens: true,
        additionalOutputTokens: 0,
      },
      nativeOutputTokens: lowOutput,
    };
  }
  const derivedAdditional = lowOutput === undefined ? 0 : Math.max(0, lowOutput - 1);
  return {
    budget: {
      ...budget,
      responseFormat,
      additionalOutputTokens: Math.max(budget.additionalOutputTokens ?? 0, derivedAdditional),
    },
  };
}

/** Inspect the effective wire request, as {@link enforceProviderRequestBudget} enforces it. */
export function inspectProviderRequestBudget(
  input: ProviderRequestBudgetInput,
): FinalRequestBudgetInspection {
  return inspectFinalRequestBudget(resolveEffectiveBudget(input).budget);
}

/** Reject an effective wire request that cannot fit the served limits. */
export function enforceProviderRequestBudget(
  input: ProviderRequestBudgetInput,
): { maxOutputTokens: number; estimatedInputTokens: number | null } {
  const effective = resolveEffectiveBudget(input);
  const result = enforceFinalRequestBudget(effective.budget);
  return effective.nativeOutputTokens === undefined ? result : {
    ...result,
    maxOutputTokens: Math.min(input.requestedOutputTokens, effective.nativeOutputTokens),
  };
}

/** Best-effort estimate of the assembled request, before provider-specific framing. */
export function inspectFinalRequestBudget(
  input: FinalRequestBudgetInput,
): FinalRequestBudgetInspection {
  const outputLimit = input.limit?.output;
  const additionalOutputTokens = input.additionalOutputTokens ?? 0;
  // An explicit request must fit the ceiling with its additive tokens; an
  // implicit one is capped, unless the additive tokens alone leave no room.
  const outputExceeded = outputLimit !== undefined &&
    (input.explicitOutputTokens === true
      ? input.requestedOutputTokens + additionalOutputTokens > outputLimit
      : additionalOutputTokens >= outputLimit);
  // Additive thinking tokens reach the wire on top of the output request, so
  // they count against the served output ceiling as well as the window.
  const cappedOutputTokens = outputLimit === undefined
    ? input.requestedOutputTokens
    : Math.min(input.requestedOutputTokens, outputLimit - additionalOutputTokens);
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
