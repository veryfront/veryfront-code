import { INVALID_ARGUMENT } from "#veryfront/errors";
import { stringifyBoundedJsonRequest } from "../http-safety.ts";

const MAX_LIVE_EVAL_TEXT_BYTES = 1024 * 1024;
const MAX_LIVE_EVAL_TOOLS = 1_000;
const MAX_LIVE_EVAL_METADATA_ENTRIES = 1_000;
const MAX_LIVE_EVAL_STEPS = 1_000;

function assertText(value: string, label: string, allowEmpty = false): void {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a string` });
  }
  if (new TextEncoder().encode(value).byteLength > MAX_LIVE_EVAL_TEXT_BYTES) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must not exceed ${MAX_LIVE_EVAL_TEXT_BYTES} UTF-8 bytes`,
    });
  }
}

function validateLiveEvalRequestInput(input: BuildLiveEvalRequestBodyInput): void {
  assertText(input.testCaseId, "testCaseId");
  assertText(input.prompt, "prompt", true);
  for (
    const [label, value] of [
      ["projectId", input.projectId],
      ["branchId", input.branchId],
      ["model", input.model],
      ["conversationId", input.conversationId],
    ] as const
  ) {
    if (value !== undefined && value !== null) assertText(value, label);
  }
  if (input.allowedTools !== undefined) {
    if (!Array.isArray(input.allowedTools) || input.allowedTools.length > MAX_LIVE_EVAL_TOOLS) {
      throw INVALID_ARGUMENT.create({
        detail: `allowedTools must contain at most ${MAX_LIVE_EVAL_TOOLS} entries`,
      });
    }
    for (const tool of input.allowedTools) assertText(tool, "allowedTools entry");
  }
  if (
    input.maxSteps !== undefined &&
    (!Number.isSafeInteger(input.maxSteps) || input.maxSteps < 1 ||
      input.maxSteps > MAX_LIVE_EVAL_STEPS)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `maxSteps must be an integer between 1 and ${MAX_LIVE_EVAL_STEPS}`,
    });
  }
  if (input.metadata !== undefined) {
    if (
      input.metadata === null || typeof input.metadata !== "object" ||
      Array.isArray(input.metadata)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "metadata must be an object" });
    }
    const entries = Object.entries(input.metadata);
    if (entries.length > MAX_LIVE_EVAL_METADATA_ENTRIES) {
      throw INVALID_ARGUMENT.create({
        detail: `metadata must contain at most ${MAX_LIVE_EVAL_METADATA_ENTRIES} entries`,
      });
    }
    for (const [key, value] of entries) {
      assertText(key, "metadata key");
      assertText(value, `metadata.${key}`, true);
    }
  }
}

/** Public API contract for live eval request body. */
export interface LiveEvalRequestBody {
  threadId: string;
  runId: string;
  state: Record<string, string>;
  tools: unknown[];
  context: unknown[];
  forwardedProps?: {
    veryfront: Record<string, unknown>;
  };
  messages: Array<{
    id: string;
    role: "user";
    content: string;
  }>;
}

/** Input payload for build live eval request body. */
export interface BuildLiveEvalRequestBodyInput {
  testCaseId: string;
  prompt: string;
  metadata?: Record<string, string>;
  projectId: string | null;
  branchId?: string;
  model?: string;
  conversationId?: string | null;
  allowedTools?: string[];
  forceRuntimeOverrides?: boolean;
  maxSteps?: number;
}

/** Builds live eval request body. */
export function buildLiveEvalRequestBody(
  input: BuildLiveEvalRequestBodyInput,
): LiveEvalRequestBody {
  validateLiveEvalRequestInput(input);
  const veryfront: Record<string, unknown> = {};
  if (input.projectId) {
    veryfront.projectId = input.projectId;
  }
  if (input.conversationId) {
    veryfront.conversationId = input.conversationId;
  }
  if (input.branchId) {
    veryfront.branchId = input.branchId;
  }
  if (input.model) {
    veryfront.model = input.model;
  }
  if (input.allowedTools || input.forceRuntimeOverrides || input.maxSteps !== undefined) {
    veryfront.runtimeOverrides = {
      ...(input.allowedTools || input.forceRuntimeOverrides
        ? { allowedTools: input.allowedTools ?? [] }
        : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
    };
  }

  const body: LiveEvalRequestBody = {
    threadId: crypto.randomUUID(),
    runId: `eval-run-${crypto.randomUUID()}`,
    state: {
      ...(input.metadata ?? {}),
      evalCase: input.testCaseId,
    },
    tools: [],
    context: [],
    ...(Object.keys(veryfront).length > 0
      ? {
        forwardedProps: {
          veryfront,
        },
      }
      : {}),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: input.prompt,
      },
    ],
  };
  const snapshot = structuredClone(body);
  stringifyBoundedJsonRequest(snapshot);
  return snapshot;
}
