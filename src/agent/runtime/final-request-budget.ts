import { stringifyChatJson } from "../../chat/json-value.ts";
import { DEFAULT_MESSAGE_PREP_LIMITS } from "../../chat/message-prep.ts";
import { AGENT_CONTEXT_WINDOW_EXCEEDED, CONFIG_INVALID } from "#veryfront/errors";
import {
  buildModelCallContextRequest,
  resolveModelCallNativeTools,
} from "#veryfront/runtime/model-call-context-request.ts";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const isArray = Array.isArray;

function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? getOwnDescriptor(value, key)?.value
    : undefined;
}

/**
 * Whether a UTF-16 unit belongs to a script that common tokenizers are known
 * to cover efficiently: Latin-1 and Latin Extended (with combining marks),
 * Greek, Cyrillic, Hebrew, Arabic and general punctuation. This is an explicit
 * allowlist; every other script is treated as dense by default.
 */
function isEfficientScriptUnit(code: number): boolean {
  return (code >= 0x0080 && code <= 0x052f) || // Latin-1, Latin Ext-A/B, IPA, marks, Greek, Cyrillic
    (code >= 0x0590 && code <= 0x06ff) || // Hebrew, Arabic
    (code >= 0x0750 && code <= 0x077f) || // Arabic Supplement
    (code >= 0x1e00 && code <= 0x1fff) || // Latin Extended Additional, Greek Extended
    (code >= 0x2000 && code <= 0x206f); // General punctuation
}

/** Characters per token assumed for the allowlisted non-ASCII scripts. */
const EFFICIENT_SCRIPT_CHARS_PER_TOKEN = 2;

/**
 * Estimate the tokens of one serialized request value, safe by default. ASCII
 * text averages about four characters per token, and the allowlisted scripts
 * (see {@link isEfficientScriptUnit}) usually two to four, so they count at
 * two. Every other non-ASCII UTF-16 unit counts as one token: CJK, kana,
 * Hangul, Thai, Devanagari, Ethiopic and any script without a known bound can
 * use one or more tokens per character, and an astral character such as an
 * emoji counts as two through its surrogate pair.
 */
export function estimateRequestTokens(value: unknown): number {
  const text = stringifyChatJson(value ?? "");
  let ascii = 0;
  let efficient = 0;
  let dense = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) ascii++;
    else if (isEfficientScriptUnit(code)) efficient++;
    else dense++;
  }
  return Math.ceil(ascii / DEFAULT_MESSAGE_PREP_LIMITS.charsPerToken) +
    Math.ceil(efficient / EFFICIENT_SCRIPT_CHARS_PER_TOKEN) + dense;
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

/**
 * Share of the context window an implicit output expansion leaves unused. The
 * input estimate is a heuristic, not a tokenizer upper bound: dense scripts
 * are counted per character, but code, base64-like tool output and provider
 * framing can still tokenize somewhat above it. Keeping this slack makes such
 * a moderate underestimate shrink the unused tail instead of producing a
 * provider-side `input + max_tokens > context` rejection.
 */
export const IMPLICIT_OUTPUT_CONTEXT_SAFETY_RATIO = 0.05;

/** Token ceilings the served model deployment declares. */
export type ServedRequestLimit = { readonly context?: number; readonly output?: number };

/** Inputs for estimating one assembled provider request. */
export type FinalRequestBudgetInput = {
  system: unknown;
  messages: readonly unknown[];
  tools?: Record<string, unknown>;
  /**
   * A native provider tool list that replaces `tools` on the wire. When set,
   * its value is measured instead of the neutral tool schemas.
   */
  nativeTools?: { readonly value: unknown };
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

/**
 * A wire output limit, usually a native provider control, must be a positive
 * integer: a zero, negative or fractional value would shrink the reserved
 * output and admit input that cannot fit, and the provider rejects it anyway.
 */
function wireOutputTokens(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw CONFIG_INVALID.create({
      detail: `Provider output limit must be a positive integer, received ${String(value)}`,
    });
  }
  return value;
}

function resolveEffectiveBudget(
  input: ProviderRequestBudgetInput,
): { budget: FinalRequestBudgetInput; nativeOutputTokens?: number } {
  const { model, reasoning, providerOptions, ...neutralBudget } = input;
  if (neutralBudget.limit === undefined) return { budget: neutralBudget };
  // A native tool list replaces the neutral one on the wire, so the request
  // is measured with the tools the provider actually receives.
  const nativeTools = resolveModelCallNativeTools(
    model,
    { ...(providerOptions === undefined ? {} : { providerOptions }) } as ModelCallSource,
  );
  const budget = nativeTools === undefined ? neutralBudget : { ...neutralBudget, nativeTools };
  const probe = (maxOutputTokens: number) =>
    buildModelCallContextRequest(model, {
      maxOutputTokens,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(providerOptions === undefined ? {} : { providerOptions }),
      ...(budget.responseFormat === undefined ? {} : { responseFormat: budget.responseFormat }),
      tools: toolDescriptors(budget.tools),
      // A document can move an adaptive OpenAI request to Responses.
      prompt: budget.messages,
    } as ModelCallSource);
  const low = probe(1);
  const high = probe(2);
  const responseFormat = low?.responseFormat ?? budget.responseFormat;
  const lowOutput = wireOutputTokens(low?.maxOutputTokens);
  const highOutput = wireOutputTokens(high?.maxOutputTokens);
  // Native whole-object replacement can remove the neutral output cap. The
  // provider default is unknown, so reserving the unsent neutral value would
  // admit a request that can exceed either served ceiling.
  if (lowOutput === undefined || highOutput === undefined) {
    throw CONFIG_INVALID.create({
      detail:
        "Provider request has no wire output limit; include a positive output cap in the native provider configuration",
    });
  }
  if (lowOutput === highOutput) {
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
  const derivedAdditional = Math.max(0, lowOutput - 1);
  // A fixed explicit request can reach the provider's model output clamp.
  // Measure that actual value rather than extrapolating the small probes.
  // Implicit requests can later be lowered to fit the window, so they still
  // reserve the full additive budget at those lower, unclamped values.
  const explicitOutput = budget.explicitOutputTokens === true
    ? wireOutputTokens(probe(budget.requestedOutputTokens)?.maxOutputTokens)
    : undefined;
  // A builder that clamps the explicit request below what was asked sends the
  // clamped value, so that wire value is the output to reserve and check.
  if (explicitOutput !== undefined && explicitOutput < budget.requestedOutputTokens) {
    return {
      budget: {
        ...budget,
        responseFormat,
        requestedOutputTokens: explicitOutput,
        additionalOutputTokens: 0,
      },
    };
  }
  const additionalOutputTokens = explicitOutput === undefined
    ? Math.max(budget.additionalOutputTokens ?? 0, derivedAdditional)
    : explicitOutput - budget.requestedOutputTokens;
  return {
    budget: {
      ...budget,
      responseFormat,
      additionalOutputTokens,
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
  const toolSchemas = input.nativeTools !== undefined
    ? input.nativeTools.value
    : Object.entries(input.tools ?? {}).map(([name, value]) => {
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
  const rawInputTokens = estimateRequestTokens(input.system) +
    estimateRequestTokens(measured.messages) + estimateRequestTokens(toolSchemas) +
    (input.responseFormat === undefined ? 0 : estimateRequestTokens(input.responseFormat));
  // This heuristic margin is not a tokenizer upper bound: media and
  // provider-specific framing can use more tokens than this estimate.
  const estimatedInputTokens = Math.ceil(rawInputTokens * 1.1) + 16;
  const availableOutputTokens = input.limit.context - estimatedInputTokens -
    additionalOutputTokens -
    Math.ceil(input.limit.context * IMPLICIT_OUTPUT_CONTEXT_SAFETY_RATIO);
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

/**
 * Memoize request-budget inspections for one fitting pass. Fitting re-inspects
 * the same candidate (messages array, exposure plan) repeatedly, for example
 * the inline baseline before each historical result, and every inspection
 * reassembles, probes and serializes the whole request. Candidates are fresh
 * arrays, so identity is a sound key while the pass runs; `variant` captures
 * the remaining mutable input (whether stored references expose the reader).
 */
export function memoizeRequestBudgetInspection<M extends object, P extends object, R>(
  inspect: (messages: M, plan: P) => R,
  variant: () => boolean,
): (messages: M, plan: P) => R {
  const cache = new WeakMap<M, Map<P, [R | undefined, R | undefined]>>();
  return (messages, plan) => {
    let byPlan = cache.get(messages);
    if (!byPlan) {
      byPlan = new Map();
      cache.set(messages, byPlan);
    }
    let entry = byPlan.get(plan);
    if (!entry) {
      entry = [undefined, undefined];
      byPlan.set(plan, entry);
    }
    const slot = variant() ? 1 : 0;
    return entry[slot] ??= inspect(messages, plan);
  };
}
