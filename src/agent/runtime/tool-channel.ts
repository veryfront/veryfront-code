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
 * impossible by construction. This module holds that policy and the model table
 * that decides which models get it, so the agent loop stays readable and the
 * policy is reviewable in one place.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { splitModelId } from "./provider-tool-compat.ts";

const IntrinsicReflectApply = Reflect.apply;
const SetPrototypeHas = Set.prototype.has;

function hasSetValue<T>(set: ReadonlySet<T>, value: T): boolean {
  return IntrinsicReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

/**
 * Value sent as `tool_choice`. Every provider request builder in this package
 * normalizes a bare string, and the OpenAI chat builder passes it through
 * verbatim, which is the wire format Mistral serves.
 */
export type ForcedToolChoice = "any" | "required";

/** How the framework keeps one model inside the tool-calling channel. */
export interface ToolChannelProfile {
  /**
   * Whether the framework forces the tool channel for this model. A model that
   * holds the channel keeps the provider default, because forcing would cost a
   * legitimate no-tool answer and buy nothing.
   */
  readonly forceByDefault: boolean;
  /**
   * The `tool_choice` value this provider accepts. OpenAI names it
   * `"required"`; Mistral, Anthropic, and Google all accept `"any"`.
   */
  readonly toolChoiceValue: ForcedToolChoice;
  /**
   * How long forcing lasts. `"first-step"` forces only the opening step;
   * `"until-tool-call"` keeps forcing until the model makes its first real tool
   * call, then releases the channel so the run can still end in prose.
   */
  readonly forceScope: "first-step" | "until-tool-call";
}

function createProfile(
  forceByDefault: boolean,
  toolChoiceValue: ForcedToolChoice,
): ToolChannelProfile {
  return Object.freeze({
    forceByDefault,
    toolChoiceValue,
    forceScope: "until-tool-call",
  });
}

/**
 * The default: the model holds the tool channel on its own, so the request
 * keeps the provider default. Forcing here would cost a legitimate no-tool
 * answer and buy nothing.
 */
const HOLDS_CHANNEL = createProfile(false, "any");
/** The same policy for OpenAI, which spells the forced value `"required"`. */
const HOLDS_CHANNEL_OPENAI = createProfile(false, "required");
/** Forced until the model's first tool call. */
const NEEDS_FORCED_CHANNEL = createProfile(true, "any");

/**
 * Providers observed to answer in prose while tool schemas were in the request.
 * `mistral/mistral-small-2503` is the measured case; the entry is per provider
 * because the failure follows the serving stack, not one checkpoint.
 */
const FORCED_CHANNEL_PROVIDERS = new Set(["mistral"]);

/** Resolve how this model is kept inside the tool-calling channel. */
export function getToolChannelProfile(model?: string): ToolChannelProfile {
  const { provider } = splitModelId(model);
  if (hasSetValue(FORCED_CHANNEL_PROVIDERS, provider)) return NEEDS_FORCED_CHANNEL;
  if (provider === "openai") return HOLDS_CHANNEL_OPENAI;
  return HOLDS_CHANNEL;
}

/**
 * Operator override, for measuring the policy against a real project without
 * rebuilding. `off` restores the behavior before this module.
 */
export type ToolChannelMode = "default" | "off" | "force-first-step" | "force-until-tool-call";

/** Read the tool-channel override for this process. */
export function resolveToolChannelModeFromEnv(): ToolChannelMode {
  const value = getHostEnv("VF_AGENT_TOOL_CHANNEL");
  return value === "off" || value === "force-first-step" || value === "force-until-tool-call"
    ? value
    : "default";
}

function applyToolChannelMode(
  channel: ToolChannelProfile,
  mode: ToolChannelMode,
): ToolChannelProfile {
  if (mode === "default") return channel;
  if (mode === "off") return { ...channel, forceByDefault: false };
  return {
    ...channel,
    forceByDefault: true,
    forceScope: mode === "force-first-step" ? "first-step" : "until-tool-call",
  };
}

/** Inputs that decide the `tool_choice` for one model step. */
export interface ToolChannelStepInput {
  /** Zero-based index of this step within the agent run. */
  readonly step: number;
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
 * on the provider default.
 */
export function resolveStepToolChoice(
  profile: ToolChannelProfile,
  input: ToolChannelStepInput,
  mode: ToolChannelMode = "default",
): ForcedToolChoice | undefined {
  const effective = applyToolChannelMode(profile, mode);
  if (!effective.forceByDefault) return undefined;
  if (!input.hasTools || input.hasOutputSchema) return undefined;
  if (input.madeToolCall) return undefined;
  if (effective.forceScope === "first-step" && input.step !== 0) return undefined;
  return effective.toolChoiceValue;
}
