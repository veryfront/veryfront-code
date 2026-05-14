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

export function buildLiveEvalRequestBody(input: BuildLiveEvalRequestBodyInput) {
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
