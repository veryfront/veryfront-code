/**
 * Keep a weaker model inside the provider function-calling channel.
 *
 * Some models that advertise tool calling drift out of the channel when a run
 * carries a large system prompt and several tool schemas. Two shapes of that
 * failure reach an agent run as a silent wrong answer rather than an error:
 *
 * 1. The model answers in prose that it has no tools, although the schemas were
 *    sent and billed as input. The loop sees no tool calls and completes.
 * 2. The model writes the tool call it wanted to make as assistant text, for
 *    example `[{"name":"get_file","arguments":{"path":"a.txt"}}]`. The loop
 *    again sees no tool calls and completes, one step into a multi-step task.
 *
 * This module holds the two countermeasures and the model table that decides
 * which models get them, so the agent loop stays readable and the policy is
 * reviewable in one place.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { pushPrivateArray } from "#veryfront/security/private-array.ts";
import { privateTextSlice, privateTextTrim } from "#veryfront/security/private-text.ts";
import { splitModelId } from "./provider-tool-compat.ts";
import type { RuntimeGenerateToolCall } from "./runtime-tool-types.ts";

const ObjectKeys = Object.keys;
const ObjectHasOwn = Object.hasOwn;

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
  /**
   * Convert an assistant message that is exactly a tool-call payload into real
   * tool calls instead of ending the run on it.
   */
  readonly recoverTextToolCalls: boolean;
}

function createProfile(
  forceByDefault: boolean,
  recoverTextToolCalls: boolean,
  toolChoiceValue: ForcedToolChoice,
): ToolChannelProfile {
  return Object.freeze({
    forceByDefault,
    toolChoiceValue,
    forceScope: "until-tool-call",
    recoverTextToolCalls,
  });
}

const HOLDS_CHANNEL = createProfile(false, false, "any");
const HOLDS_CHANNEL_OPENAI = createProfile(false, false, "required");
const DRIFTS_FROM_CHANNEL = createProfile(false, false, "any");
const NEEDS_FORCED_CHANNEL = createProfile(true, true, "any");

/**
 * Providers whose models hold the tool channel on their own. Forcing a tool on
 * these would cost a legitimate no-tool answer and buy nothing, so they keep
 * the provider default and the text-recovery path stays off.
 */
const CHANNEL_HOLDING_PROVIDERS = new Set(["anthropic", "google", "google-ai-studio"]);

/**
 * Providers observed to answer in prose while tool schemas were in the request.
 * `mistral/mistral-small-2503` is the measured case; the entry is per provider
 * because the failure follows the serving stack, not one checkpoint.
 */
const FORCED_CHANNEL_PROVIDERS = new Set(["mistral"]);

/** Per-model override, for a checkpoint that behaves unlike its provider. */
const MODEL_TOOL_CHANNEL_OVERRIDES: Readonly<Record<string, ToolChannelProfile>> = Object.freeze(
  {},
);

/** Resolve how this model is kept inside the tool-calling channel. */
export function getToolChannelProfile(model?: string): ToolChannelProfile {
  const { provider, modelName } = splitModelId(model);
  const override = ObjectHasOwn(MODEL_TOOL_CHANNEL_OVERRIDES, `${provider}/${modelName}`)
    ? MODEL_TOOL_CHANNEL_OVERRIDES[`${provider}/${modelName}`]
    : undefined;
  if (override) return override;
  if (FORCED_CHANNEL_PROVIDERS.has(provider)) return NEEDS_FORCED_CHANNEL;
  if (provider === "openai") return HOLDS_CHANNEL_OPENAI;
  if (CHANNEL_HOLDING_PROVIDERS.has(provider)) return HOLDS_CHANNEL;
  return DRIFTS_FROM_CHANNEL;
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
  if (mode === "off") return { ...channel, forceByDefault: false, recoverTextToolCalls: false };
  return {
    ...channel,
    forceByDefault: true,
    forceScope: mode === "force-first-step" ? "first-step" : "until-tool-call",
  };
}

/** Whether text-emitted tool calls are read back for this model and mode. */
export function shouldRecoverTextToolCalls(
  profile: ToolChannelProfile,
  mode: ToolChannelMode = "default",
): boolean {
  return applyToolChannelMode(profile, mode).recoverTextToolCalls;
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

const MAX_RECOVERABLE_TOOL_CALL_TEXT_LENGTH = 16_384;
const JSON_FENCE_PATTERN = /^```(?:json|JSON)?\s*\n([\s\S]*)\n?```$/;

/** Keys a recovered payload may carry beside its name and arguments. */
const IGNORED_PAYLOAD_KEYS = new Set(["id", "type", "index"]);
const NAME_KEYS = ["name", "tool", "tool_name", "toolName", "function_name"];
const ARGUMENT_KEYS = ["arguments", "parameters", "input", "args", "tool_input", "toolInput"];

function readStringMember(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    if (!ObjectHasOwn(value, key)) continue;
    const member = value[key];
    if (typeof member !== "string" || member.length === 0) return undefined;
    return member;
  }
  return undefined;
}

function readArgumentsMember(
  value: Record<string, unknown>,
  keys: readonly string[],
): { found: boolean; input?: Record<string, unknown> } {
  for (const key of keys) {
    if (!ObjectHasOwn(value, key)) continue;
    const member = value[key];
    if (typeof member === "string") {
      let parsed: unknown;
      try {
        parsed = privateJsonParse(member);
      } catch {
        return { found: false };
      }
      return isPlainObject(parsed) ? { found: true, input: parsed } : { found: false };
    }
    if (isPlainObject(member)) return { found: true, input: member };
    return { found: false };
  }
  return { found: false };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Read one tool-call-shaped payload.
 *
 * Every key must be accounted for. A payload that carries anything beyond a
 * name, an argument bag, and the ignored wire keys is rejected, which is what
 * keeps ordinary JSON output from being read as a tool call.
 */
function readToolCallPayload(
  value: unknown,
  knownToolNames: ReadonlySet<string>,
): { toolName: string; input: Record<string, unknown> } | undefined {
  if (!isPlainObject(value)) return undefined;

  // `{"function": {"name": …, "arguments": …}}` wraps the same payload.
  if (ObjectHasOwn(value, "function")) {
    for (const key of ObjectKeys(value)) {
      if (key !== "function" && !IGNORED_PAYLOAD_KEYS.has(key)) return undefined;
    }
    return readToolCallPayload(value.function, knownToolNames);
  }

  const toolName = readStringMember(value, NAME_KEYS);
  if (toolName === undefined || !knownToolNames.has(toolName)) return undefined;

  const argumentsMember = readArgumentsMember(value, ARGUMENT_KEYS);
  if (!argumentsMember.found || argumentsMember.input === undefined) return undefined;

  let sawName = false;
  let sawArguments = false;
  for (const key of ObjectKeys(value)) {
    if (!sawName && NAME_KEYS.includes(key)) {
      sawName = true;
      continue;
    }
    if (!sawArguments && ARGUMENT_KEYS.includes(key)) {
      sawArguments = true;
      continue;
    }
    if (!IGNORED_PAYLOAD_KEYS.has(key)) return undefined;
  }

  return { toolName, input: argumentsMember.input };
}

function parseWholeMessageJson(text: string): unknown | undefined {
  const trimmed = privateTextTrim(text);
  if (trimmed.length === 0 || trimmed.length > MAX_RECOVERABLE_TOOL_CALL_TEXT_LENGTH) {
    return undefined;
  }
  const fenced = JSON_FENCE_PATTERN.exec(trimmed);
  const body = fenced ? privateTextTrim(fenced[1] ?? "") : trimmed;
  const first = privateTextSlice(body, 0, 1);
  if (first !== "{" && first !== "[") return undefined;
  try {
    return privateJsonParse(body);
  } catch {
    return undefined;
  }
}

/**
 * Convert an assistant message that is exactly a tool-call payload into real
 * tool calls, or return `undefined` to leave the message as prose.
 *
 * The whole message must parse as JSON, every element must be a tool-call
 * payload with no unexplained keys, and every named tool must be one this step
 * actually sent. Prose that merely contains JSON never parses whole, so it
 * cannot reach the payload check.
 */
const TOOL_CALL_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TOOL_CALL_ID_LENGTH = 9;

/**
 * Mint an id for a recovered tool call.
 *
 * A recovered call is echoed back to the provider on the next step as an
 * assistant `tool_calls` entry and a matching `tool` message. Mistral rejects
 * the whole request with HTTP 400 unless that id is exactly nine alphanumeric
 * characters, so the format is the strictest provider's, which every other
 * provider accepts as an opaque string.
 */
export function createRecoveredToolCallId(): string {
  const alphabetLength = TOOL_CALL_ID_ALPHABET.length;
  const byteLimit = 256 - (256 % alphabetLength);
  let id = "";
  while (id.length < TOOL_CALL_ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(TOOL_CALL_ID_LENGTH));
    for (let index = 0; index < bytes.length && id.length < TOOL_CALL_ID_LENGTH; index++) {
      const byte = bytes[index]!;
      if (byte >= byteLimit) continue;
      id += TOOL_CALL_ID_ALPHABET[byte % alphabetLength];
    }
  }
  return id;
}

export function recoverTextEmittedToolCalls(
  text: string,
  knownToolNames: ReadonlySet<string>,
  createToolCallId: () => string = createRecoveredToolCallId,
): RuntimeGenerateToolCall[] | undefined {
  if (knownToolNames.size === 0) return undefined;
  const parsed = parseWholeMessageJson(text);
  if (parsed === undefined) return undefined;

  const payloads = Array.isArray(parsed) ? parsed : [parsed];
  if (payloads.length === 0) return undefined;

  const toolCalls: RuntimeGenerateToolCall[] = [];
  for (let index = 0; index < payloads.length; index++) {
    if (!ObjectHasOwn(payloads, index)) return undefined;
    const payload = readToolCallPayload(payloads[index], knownToolNames);
    if (payload === undefined) return undefined;
    pushPrivateArray(toolCalls, {
      toolCallId: createToolCallId(),
      toolName: payload.toolName,
      input: payload.input,
    });
  }

  return toolCalls;
}
