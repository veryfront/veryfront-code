/**
 * One-shot model calls.
 *
 * @module llm
 *
 * @example
 * ```ts
 * import { generate } from "veryfront/llm";
 *
 * const { text } = await generate({ input: "Name three colours." });
 * ```
 */

import { agent } from "#veryfront/agent/factory.ts";
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
 * Run a single model call without constructing an agent.
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
  return agent({
    system: system ?? "",
    skills: false,
    maxSteps: 1,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...(temperature === undefined ? {} : { temperature }),
  }).generate(request);
}
