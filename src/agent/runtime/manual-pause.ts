import type { SkillDelegationOverrides } from "./skill-delegation-overrides.ts";
import {
  isValidRuntimeSkillModel,
  MAX_RUNTIME_SKILL_MODEL_LENGTH,
  MAX_RUNTIME_SKILL_STEPS,
  MAX_RUNTIME_SKILL_THINKING_TOKENS,
} from "./skill-metadata.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedParsedJsonValue } from "#veryfront/schemas/json-value.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { getToolCallSchema } from "../schemas/index.ts";
import type { Message, ToolCall } from "../types.ts";

/** Private continuation at a settled model/tool boundary, never agent configuration. */
export interface AgentPauseCheckpoint {
  version: 1;
  nextStep: number;
  messages: Message[];
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latestAssistantText: string;
  completed: boolean;
  finishReason?: string;
  recoveredEmptyResponse: boolean;
  recoveredInterruptedLocalToolBatch: boolean;
  resumeToolCallExecuted?: boolean;
  agentWriteFinalResponseToolGuardEnabled?: boolean;
  interruptedLocalToolBatchRecoveryStep?: number;
  interruptedLocalToolBatchRecoveryText?: string;
  runtimeGeneratedMessageIds?: string[];
  providerMetadata?: { messageId: string; metadata: Record<string, unknown> }[];
  hasSubmittedFormInput?: boolean;
  activeSkillDelegationOverrides?: SkillDelegationOverrides;
  toolExposureCheckpoint?: { version: 1 | 2; loadedToolNames: string[] };
}

export interface AgentManualPause {
  load(): Promise<unknown>;
  /** Check whether a pause is requested before snapshotting a bounded continuation. */
  requested?(): Promise<boolean>;
  acknowledge(checkpoint: AgentPauseCheckpoint): Promise<boolean>;
  /** Retire an oversized resumed continuation only when no pause is requested. */
  release?(): Promise<boolean>;
}

export const getAgentPauseCheckpointSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    nextStep: v.number().int().nonnegative().max(10_000),
    // Provider blocks and runtime-generated message metadata must survive unchanged.
    messages: v.array(
      v.object({
        id: v.string().min(1),
        role: v.enum(["user", "assistant", "system", "tool"] as const),
        parts: v.array(v.record(v.string(), getJsonValueSchema())),
      }).passthrough(),
    ),
    toolCalls: v.array(getToolCallSchema()),
    usage: v.object({
      promptTokens: v.number().nonnegative().refine(Number.isFinite),
      completionTokens: v.number().nonnegative().refine(Number.isFinite),
      totalTokens: v.number().nonnegative().refine(Number.isFinite),
    }).strict(),
    latestAssistantText: v.string(),
    completed: v.boolean(),
    finishReason: v.string().optional(),
    recoveredEmptyResponse: v.boolean(),
    recoveredInterruptedLocalToolBatch: v.boolean(),
    resumeToolCallExecuted: v.boolean().optional(),
    agentWriteFinalResponseToolGuardEnabled: v.boolean().optional(),
    interruptedLocalToolBatchRecoveryStep: v.number().int().nonnegative().optional(),
    interruptedLocalToolBatchRecoveryText: v.string().optional(),
    runtimeGeneratedMessageIds: v.array(v.string().min(1)).optional(),
    providerMetadata: v.array(
      v.object({
        messageId: v.string().min(1),
        metadata: v.record(v.string(), getJsonValueSchema()),
      }).strict(),
    ).optional(),
    hasSubmittedFormInput: v.boolean().optional(),
    activeSkillDelegationOverrides: v.object({
      model: v.string().max(MAX_RUNTIME_SKILL_MODEL_LENGTH).refine(isValidRuntimeSkillModel)
        .optional(),
      thinking: v.union([
        v.literal(false),
        v.number().int().positive().max(MAX_RUNTIME_SKILL_THINKING_TOKENS),
      ]).optional(),
      maxSteps: v.number().int().positive().max(MAX_RUNTIME_SKILL_STEPS).optional(),
    }).strict().optional(),
    toolExposureCheckpoint: v.object({
      version: v.union([v.literal(1), v.literal(2)]),
      loadedToolNames: v.array(v.string().min(1)),
    }).strict().optional(),
  }).strict()
);

export function parseAgentPauseCheckpoint(value: unknown): AgentPauseCheckpoint {
  const encoded = privateJsonStringify(value);
  const maxBytes = 2 * 1024 * 1024;
  if (encoded === undefined || utf8ByteLength(encoded) > maxBytes) {
    throw new TypeError("Invalid agent pause checkpoint");
  }
  const snapshot = snapshotBoundedParsedJsonValue(privateJsonParse(encoded), maxBytes);
  if (!snapshot.success) throw new TypeError("Invalid agent pause checkpoint");
  return getAgentPauseCheckpointSchema().parse(snapshot.value) as AgentPauseCheckpoint;
}

const paused = new WeakSet<object>();
const add = WeakSet.prototype.add;
const has = WeakSet.prototype.has;
const apply = Reflect.apply;

export function agentManualPauseBoundary(): Error {
  const error = new Error("Agent reached its manual pause boundary");
  apply(add, paused, [error]);
  return error;
}

export function isAgentManualPauseBoundary(error: unknown): boolean {
  return typeof error === "object" && error !== null && apply(has, paused, [error]);
}
