/**
 * One-shot model calls.
 *
 * @module llm
 *
 * @example Text
 * ```ts
 * import { generate } from "veryfront/llm";
 *
 * const { text } = await generate({ input: "Name three colours." });
 * ```
 *
 * @example Structured output
 * ```ts
 * import { generate } from "veryfront/llm";
 * import { defineSchema, lazySchema } from "veryfront/schemas";
 *
 * const { object } = await generate({
 *   input: "The checkout button does nothing on mobile Safari.",
 *   system: "Classify the support ticket.",
 *   outputSchema: lazySchema(defineSchema((v) =>
 *     v.object({
 *       category: v.enum(["bug", "billing", "feature"]),
 *       reasoning: v.string(),
 *       confidence: v.number().min(0).max(100),
 *     })
 *   )),
 * });
 *
 * object.category; // "bug" | "billing" | "feature"
 * object.confidence; // number, 0-100
 * ```
 *
 * @example Choosing a model
 * ```ts
 * import { generate } from "veryfront/llm";
 *
 * const { text } = await generate({
 *   input: "Summarise this in one line.",
 *   system: "You are terse.",
 *   model: "anthropic/claude-haiku-4-5-20251001",
 * });
 * ```
 */

import { createEphemeralAgent } from "#veryfront/agent/factory.ts";
import type {
  AgentOutputSchema,
  AgentResponse,
  InferAgentOutputSchema,
  Message,
  ModelString,
} from "#veryfront/agent/types.ts";

/** Request accepted by `generate`. */
export interface GenerateInput<
  TOutputSchema extends AgentOutputSchema | undefined = undefined,
> {
  input: string | Message[];
  /** System instructions for this call. */
  system?: string;
  /** Model in "provider/model" format. Defaults as an agent's `model` does. */
  model?: ModelString;
  /** Constrain the response to a schema and expose the parsed value as `object`. */
  outputSchema?: TOutputSchema;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

/**
 * Run a single model call without registering a reusable agent.
 *
 * Supply `outputSchema` to receive a parsed, validated `object` typed from that
 * schema. No tools, skills, or memory take part.
 */
export function generate<TOutputSchema extends AgentOutputSchema>(
  input: GenerateInput<TOutputSchema> & { outputSchema: TOutputSchema },
): Promise<AgentResponse<InferAgentOutputSchema<TOutputSchema>>>;
export function generate(input: GenerateInput): Promise<AgentResponse>;
export function generate(
  { system, temperature, outputSchema, ...request }: GenerateInput<
    AgentOutputSchema | undefined
  >,
): Promise<AgentResponse> {
  return createEphemeralAgent({
    system: system ?? "",
    skills: false,
    maxSteps: 1,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(temperature === undefined ? {} : { temperature }),
  }).generate(request);
}
