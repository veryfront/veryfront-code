/**
 * Keep a weaker model inside the provider function-calling channel.
 *
 * Some models that advertise tool calling drift out of the channel when a run
 * carries a large system prompt and several tool schemas: the model answers in
 * prose that it has no tools, although the schemas were sent and billed as
 * input. The loop sees no tool calls and completes, so the failure reaches an
 * agent run as a silent wrong answer rather than an error.
 *
 * The countermeasure is to send `tool_choice` for the affected models until the
 * model makes its first real tool call, which makes a first-step refusal
 * impossible by construction. This module holds that policy and the provider
 * list that decides which models get it, so the agent loop stays readable and
 * the policy is reviewable in one place.
 */

import { splitModelId } from "./provider-tool-compat.ts";

/**
 * The provider observed to answer in prose while tool schemas were in the
 * request. `mistral/mistral-small-2503` is the measured case; the policy is per
 * provider because the failure follows the serving stack, not one checkpoint.
 */
const FORCED_CHANNEL_PROVIDER = "mistral";

/**
 * Whether the framework forces the tool channel for this model. A model that
 * holds the channel on its own keeps the provider default, because forcing
 * would cost a legitimate no-tool answer and buy nothing.
 */
export function forcesToolChannel(model?: string): boolean {
  return splitModelId(model).provider === FORCED_CHANNEL_PROVIDER;
}

/** Inputs that decide the `tool_choice` for one model step. */
export interface ToolChannelStepInput {
  /** Whether this step sends at least one tool to the provider. */
  readonly hasTools: boolean;
  /** Whether the model has already made a real tool call in this run. */
  readonly madeToolCall: boolean;
  /**
   * Whether this run requests a structured response. Forcing a tool alongside a
   * response schema asks the model for two mutually exclusive outputs, so the
   * schema wins.
   */
  readonly hasOutputSchema: boolean;
}

/**
 * Resolve the `tool_choice` for one step, or `undefined` to leave the channel
 * on the provider default. Forcing lasts until the model makes its first real
 * tool call, then releases so the run can still end in prose.
 *
 * `"any"` is the wire value Mistral serves. Every provider request builder in
 * this package normalizes a bare string, and the OpenAI chat builder, which
 * serves Mistral, passes it through verbatim.
 */
export function resolveStepToolChoice(
  forcesChannel: boolean,
  input: ToolChannelStepInput,
): "any" | undefined {
  if (!forcesChannel || !input.hasTools) return undefined;
  if (input.hasOutputSchema || input.madeToolCall) return undefined;
  return "any";
}
