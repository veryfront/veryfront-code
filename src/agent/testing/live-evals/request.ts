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
  if (input.allowedTools || input.forceRuntimeOverrides) {
    veryfront.runtimeOverrides = {
      allowedTools: input.allowedTools ?? [],
      ...(input.maxSteps ? { maxSteps: input.maxSteps } : {}),
    };
  }

  return {
    threadId: crypto.randomUUID(),
    runId: `eval-run-${crypto.randomUUID()}`,
    state: {
      evalCase: input.testCaseId,
      ...(input.metadata ?? {}),
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
