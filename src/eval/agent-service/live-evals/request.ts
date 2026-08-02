import {
  assertFiniteEvalNumber,
  createEvalValidationError,
  isEvalRecord,
  normalizeEvalString,
  normalizeEvalStringList,
} from "../../validation.ts";

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
  const testCaseId = normalizeEvalString(input.testCaseId, "Live eval test case id");
  if (typeof input.prompt !== "string") {
    throw createEvalValidationError("Live eval prompt must be a string");
  }
  if (input.metadata !== undefined && !isEvalRecord(input.metadata)) {
    throw createEvalValidationError("Live eval metadata must be an object");
  }
  const metadata = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (typeof value !== "string") {
      throw createEvalValidationError(`Live eval metadata "${key}" must be a string`);
    }
    metadata[key] = value;
  }
  const allowedTools = input.allowedTools === undefined
    ? undefined
    : normalizeEvalStringList(input.allowedTools, "Live eval allowedTools");
  if (input.maxSteps !== undefined) {
    assertFiniteEvalNumber(input.maxSteps, "Live eval maxSteps", { integer: true, min: 1 });
  }

  const veryfront: Record<string, unknown> = {};
  if (input.projectId !== null) {
    veryfront.projectId = normalizeEvalString(input.projectId, "Live eval projectId");
  }
  if (input.conversationId !== undefined && input.conversationId !== null) {
    veryfront.conversationId = normalizeEvalString(
      input.conversationId,
      "Live eval conversationId",
    );
  }
  if (input.branchId !== undefined) {
    veryfront.branchId = normalizeEvalString(input.branchId, "Live eval branchId");
  }
  if (input.model !== undefined) {
    veryfront.model = normalizeEvalString(input.model, "Live eval model");
  }
  if (
    allowedTools !== undefined ||
    input.forceRuntimeOverrides ||
    input.maxSteps !== undefined
  ) {
    veryfront.runtimeOverrides = {
      ...(allowedTools !== undefined
        ? { allowedTools }
        : input.forceRuntimeOverrides
        ? { allowedTools: [] }
        : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
    };
  }

  return {
    threadId: crypto.randomUUID(),
    runId: `eval-run-${crypto.randomUUID()}`,
    state: {
      ...metadata,
      evalCase: testCaseId,
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
}
