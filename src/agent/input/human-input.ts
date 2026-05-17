import { defineSchema } from "#veryfront/schemas/index.ts";
import type {
  InferInput,
  InferSchema,
  SchemaValidator,
  ValidationIssue,
} from "#veryfront/extensions/schema/index.ts";
import { getAgUiRuntimeRunIdSchema } from "../runtime/ag-ui-contract.ts";
import { RunResumeSessionManager } from "../runtime/index.ts";

const TOOL_CALL_ID_SCHEMA = (v: SchemaValidator) => v.string().min(1).max(128);

export const getHumanInputOptionSchema = defineSchema((v) =>
  v.object({
    value: v.string(),
    label: v.string(),
    description: v.string().optional(),
    recommended: v.boolean().optional(),
  })
);

// Common base fields shared by every human-input field variant. Factored as a
// shape-helper because the contract DSL doesn't expose `Schema.shape` access
// nor a way to share field defaults across discriminated-union members other
// than constructing the shape repeatedly.
const baseHumanInputFieldFields = (v: SchemaValidator) => ({
  name: v.string().min(1).max(128),
  label: v.string().min(1).max(256),
  description: v.string().max(1024).optional(),
  required: v.boolean().optional().default(false),
  secret: v.boolean().optional().default(false),
});

export const getHumanInputFieldSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.enum(["text", "email", "url", "password", "number"] as const),
      placeholder: v.string().max(512).optional(),
      defaultValue: v.string().optional(),
      pattern: v.string().max(512).optional(),
      minLength: v.number().int().nonnegative().optional(),
      maxLength: v.number().int().positive().optional(),
      min: v.number().optional(),
      max: v.number().optional(),
    }),
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.literal("textarea"),
      placeholder: v.string().max(512).optional(),
      defaultValue: v.string().optional(),
      minLength: v.number().int().nonnegative().optional(),
      maxLength: v.number().int().positive().optional(),
      rows: v.number().int().positive().optional().default(3),
    }),
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.literal("select"),
      options: v.array(getHumanInputOptionSchema()).min(1),
      defaultValue: v.string().optional(),
      placeholder: v.string().max(512).optional(),
    }),
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.literal("checkbox"),
      defaultValue: v.boolean().optional().default(false),
    }),
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.literal("radio"),
      options: v.array(getHumanInputOptionSchema()).min(1),
      defaultValue: v.string().optional(),
    }),
    v.object({
      ...baseHumanInputFieldFields(v),
      type: v.literal("confirm"),
      confirmLabel: v.string().max(64).optional().default("Yes"),
      denyLabel: v.string().max(64).optional().default("No"),
    }),
  ])
);

// Base shape for HumanInputRequest so the same fields can be reused without
// `metadata` to derive `formInputToolInputSchema` (the contract DSL doesn't
// expose `.omit`).
export const humanInputRequestBaseFields = (v: SchemaValidator) => ({
  title: v.string().min(1).max(256),
  description: v.string().max(2048).optional(),
  fields: v.array(getHumanInputFieldSchema()).min(1),
  submitLabel: v.string().max(64).optional().default("Submit"),
});

export const getHumanInputRequestSchema = defineSchema((v) =>
  v.object({
    ...humanInputRequestBaseFields(v),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getHumanInputResponseValuesSchema = defineSchema((v) =>
  v.record(
    v.string(),
    v.union([v.string(), v.boolean(), v.number(), v.null()]),
  )
);

export const getHumanInputResultSchema = defineSchema((v) =>
  v.discriminatedUnion("submitted", [
    v.object({
      submitted: v.literal(true),
      values: getHumanInputResponseValuesSchema(),
    }),
    v.object({
      submitted: v.literal(false),
      values: getHumanInputResponseValuesSchema().default({}),
    }),
  ])
);

export const getHumanInputPendingRequestSchema = defineSchema((v) =>
  v.object({
    runId: getAgUiRuntimeRunIdSchema(),
    toolCallId: TOOL_CALL_ID_SCHEMA(v),
    request: getHumanInputRequestSchema(),
  })
);

export type HumanInputOption = InferSchema<ReturnType<typeof getHumanInputOptionSchema>>;
export type HumanInputField = InferSchema<ReturnType<typeof getHumanInputFieldSchema>>;
export type HumanInputFieldInput = InferInput<ReturnType<typeof getHumanInputFieldSchema>>;
export type HumanInputRequest = InferSchema<ReturnType<typeof getHumanInputRequestSchema>>;
export type HumanInputRequestInput = InferInput<ReturnType<typeof getHumanInputRequestSchema>>;
export type HumanInputResult = InferSchema<ReturnType<typeof getHumanInputResultSchema>>;
export type HumanInputPendingRequest = InferSchema<
  ReturnType<typeof getHumanInputPendingRequestSchema>
>;

export type HumanInputResumeValue = {
  result: unknown;
  isError: boolean;
};

export type DurableHumanInputFlowResult<TCreatedRequest> = {
  result: HumanInputResult;
  createdRequest: TCreatedRequest;
};

export interface ExecuteDurableHumanInputFlowOptions<
  TCreatedRequest,
  TSnapshot,
> {
  sessionManager?: RunResumeSessionManager<HumanInputResumeValue> | undefined;
  runId: string;
  threadId: string;
  toolCallId: string;
  request: HumanInputRequestInput;
  timeoutMs: number;
  pollIntervalMs: number;
  onRequest: (
    request: HumanInputPendingRequest,
  ) => TCreatedRequest | Promise<TCreatedRequest>;
  onCreatedRequest?: ((request: TCreatedRequest) => void | Promise<void>) | undefined;
  getSnapshot: (request: TCreatedRequest) => TSnapshot | Promise<TSnapshot>;
  resolveSnapshot: (snapshot: TSnapshot) => HumanInputResult | undefined;
}

export interface WaitForDurableHumanInputResolutionOptions<TSnapshot> {
  deadline: number;
  pollIntervalMs: number;
  getSnapshot: () => TSnapshot | Promise<TSnapshot>;
  resolveSnapshot: (snapshot: TSnapshot) => HumanInputResult | undefined;
}

export interface WaitForHumanInputOptions {
  sessionManager: RunResumeSessionManager<HumanInputResumeValue>;
  runId: string;
  toolCallId: string;
  request: HumanInputRequestInput;
  onRequest?: ((request: HumanInputPendingRequest) => void | Promise<void>) | undefined;
}

export class HumanInputResumeError extends Error {
  constructor(readonly detail: unknown) {
    super(
      typeof detail === "string" ? detail : "Human input resume failed",
    );
    this.name = "HumanInputResumeError";
  }
}

export class InvalidHumanInputResultError extends Error {
  constructor(readonly detail: ValidationIssue[]) {
    super("Invalid human input resume payload");
    this.name = "InvalidHumanInputResultError";
  }
}

export async function executeDurableHumanInputFlow<
  TCreatedRequest,
  TSnapshot,
>(
  options: ExecuteDurableHumanInputFlowOptions<TCreatedRequest, TSnapshot>,
): Promise<DurableHumanInputFlowResult<TCreatedRequest>> {
  const sessionManager = options.sessionManager ??
    new RunResumeSessionManager<HumanInputResumeValue>();
  sessionManager.startRun({
    runId: options.runId,
    threadId: options.threadId,
  });

  let resolveCreatedRequest: ((request: TCreatedRequest) => void) | null = null;
  const createdRequestPromise = new Promise<TCreatedRequest>((resolve) => {
    resolveCreatedRequest = resolve;
  });

  try {
    const result = await waitForHumanInput({
      sessionManager,
      runId: options.runId,
      toolCallId: options.toolCallId,
      request: options.request,
      onRequest: async (pendingRequest) => {
        const currentRequest = await options.onRequest(pendingRequest);
        if (!resolveCreatedRequest) {
          throw new Error("Durable human input flow could not track the created request");
        }
        resolveCreatedRequest(currentRequest);
        await options.onCreatedRequest?.(currentRequest);

        void bridgeDurableHumanInputRequest({
          sessionManager,
          runId: options.runId,
          toolCallId: options.toolCallId,
          createdRequest: currentRequest,
          timeoutMs: options.timeoutMs,
          pollIntervalMs: options.pollIntervalMs,
          getSnapshot: options.getSnapshot,
          resolveSnapshot: options.resolveSnapshot,
        });
      },
    });

    const createdRequest = await createdRequestPromise;

    sessionManager.completeRun(options.runId);
    return {
      result,
      createdRequest,
    };
  } catch (error) {
    sessionManager.failRun(options.runId);
    throw error;
  }
}

export async function waitForHumanInput(
  options: WaitForHumanInputOptions,
): Promise<HumanInputResult> {
  options.sessionManager.prepareForSignal(options.runId, options.toolCallId);
  const pendingRequest = getHumanInputPendingRequestSchema().parse({
    runId: options.runId,
    toolCallId: options.toolCallId,
    request: options.request,
  });

  await options.onRequest?.(pendingRequest);

  const resumed = await options.sessionManager.waitForSignal(options.runId, options.toolCallId);
  if (resumed.isError) {
    throw new HumanInputResumeError(resumed.result);
  }

  const parsed = getHumanInputResultSchema().safeParse(resumed.result);
  if (!parsed.success) {
    throw new InvalidHumanInputResultError(parsed.issues);
  }

  return parsed.data;
}

export async function waitForDurableHumanInputResolution<TSnapshot>(
  options: WaitForDurableHumanInputResolutionOptions<TSnapshot>,
): Promise<HumanInputResult> {
  while (Date.now() < options.deadline) {
    const snapshot = await options.getSnapshot();
    const result = options.resolveSnapshot(snapshot);

    if (result) {
      return result;
    }

    await delay(options.pollIntervalMs);
  }

  throw new Error("Timed out while waiting for durable human input resolution");
}

async function bridgeDurableHumanInputRequest<
  TCreatedRequest,
  TSnapshot,
>(input: {
  sessionManager: RunResumeSessionManager<HumanInputResumeValue>;
  runId: string;
  toolCallId: string;
  createdRequest: TCreatedRequest;
  timeoutMs: number;
  pollIntervalMs: number;
  getSnapshot: (request: TCreatedRequest) => TSnapshot | Promise<TSnapshot>;
  resolveSnapshot: (snapshot: TSnapshot) => HumanInputResult | undefined;
}): Promise<void> {
  try {
    const resolved = await waitForDurableHumanInputResolution({
      deadline: Date.now() + input.timeoutMs,
      pollIntervalMs: input.pollIntervalMs,
      getSnapshot: () => input.getSnapshot(input.createdRequest),
      resolveSnapshot: input.resolveSnapshot,
    });

    submitHumanInputResumeValue(input.sessionManager, input.runId, input.toolCallId, {
      result: resolved,
      isError: false,
    });
  } catch (error) {
    submitHumanInputResumeValue(input.sessionManager, input.runId, input.toolCallId, {
      result: error instanceof Error ? error.message : String(error),
      isError: true,
    });
  }
}

function submitHumanInputResumeValue(
  sessionManager: RunResumeSessionManager<HumanInputResumeValue>,
  runId: string,
  toolCallId: string,
  value: HumanInputResumeValue,
) {
  try {
    sessionManager.submitSignal(runId, {
      waitKey: toolCallId,
      value,
    });
  } catch {
    // Ignore late resume submissions once the local wait has already completed
    // or the ephemeral session has been finalized.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
