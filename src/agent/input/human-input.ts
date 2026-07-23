import { defineSchema } from "#veryfront/schemas/index.ts";
import { AGENT_ERROR, AGENT_TIMEOUT } from "#veryfront/errors";
import type {
  Schema,
  SchemaValidator,
  ValidationIssue,
} from "#veryfront/extensions/schema/index.ts";
import { getAgUiRuntimeRunIdSchema } from "../runtime/ag-ui-contract.ts";
import { RunResumeSessionManager } from "../runtime/index.ts";

const TOOL_CALL_ID_SCHEMA = (v: SchemaValidator) => v.string().min(1).max(128);

/** Selectable option for choice-based human-input fields. */
export interface HumanInputOption {
  /** Submitted option value. */
  value: string;
  /** Label displayed to the user. */
  label: string;
  /** Optional supporting description. */
  description?: string;
  /** Whether the UI should present this option as recommended. */
  recommended?: boolean;
}

/** Field displayed in a durable human-input request. */
export type HumanInputField =
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Single-line field category. */
    type: "text" | "email" | "url" | "password" | "number";
    /** Optional input placeholder. */
    placeholder?: string;
    /** Optional initial string value. */
    defaultValue?: string;
    /** Optional regular-expression source for string validation. */
    pattern?: string;
    /** Optional minimum string length. */
    minLength?: number;
    /** Optional maximum string length. */
    maxLength?: number;
    /** Optional minimum numeric value. */
    min?: number;
    /** Optional maximum numeric value. */
    max?: number;
  }
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Multiline text field discriminator. */
    type: "textarea";
    /** Optional input placeholder. */
    placeholder?: string;
    /** Optional initial string value. */
    defaultValue?: string;
    /** Optional minimum string length. */
    minLength?: number;
    /** Optional maximum string length. */
    maxLength?: number;
    /** Number of visible text rows. */
    rows: number;
  }
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Select field discriminator. */
    type: "select";
    /** Available choices. */
    options: HumanInputOption[];
    /** Optional initial option value. */
    defaultValue?: string;
    /** Optional input placeholder. */
    placeholder?: string;
  }
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Checkbox field discriminator. */
    type: "checkbox";
    /** Initial checked state. */
    defaultValue: boolean;
  }
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Radio field discriminator. */
    type: "radio";
    /** Available choices. */
    options: HumanInputOption[];
    /** Optional initial option value. */
    defaultValue?: string;
  }
  | {
    /** Stable field name used in submitted values. */
    name: string;
    /** Label displayed to the user. */
    label: string;
    /** Optional supporting description. */
    description?: string;
    /** Whether a response value is required. */
    required: boolean;
    /** Whether the response value contains a secret. */
    secret: boolean;
    /** Confirmation field discriminator. */
    type: "confirm";
    /** Label for the affirmative choice. */
    confirmLabel: string;
    /** Label for the negative choice. */
    denyLabel: string;
  };

/** Durable form request presented to a human responder. */
export interface HumanInputRequest {
  /** Form title. */
  title: string;
  /** Optional form description. */
  description?: string;
  /** Fields displayed in the form. */
  fields: HumanInputField[];
  /** Label for the form submission action. */
  submitLabel: string;
  /** Optional host metadata. */
  metadata?: Record<string, unknown>;
}

/** Input accepted when constructing a human-input field. */
export type HumanInputFieldInput = HumanInputField;

/** Input accepted when constructing a human-input request. */
export type HumanInputRequestInput = HumanInputRequest;

/** Result returned when a durable human-input request resolves. */
export type HumanInputResult =
  | { submitted: true; values: Record<string, string | boolean | number | null> }
  | { submitted: false; values: Record<string, string | boolean | number | null> };

/** Pending human-input request associated with a runtime wait. */
export interface HumanInputPendingRequest {
  /** Runtime run identifier. */
  runId: string;
  /** Tool call waiting for the response. */
  toolCallId: string;
  /** Form request presented to the user. */
  request: HumanInputRequest;
}

/** Zod schema for get human input option. */
export const getHumanInputOptionSchema: () => Schema<HumanInputOption> = defineSchema((v) =>
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

/** Zod schema for get human input field. */
export const getHumanInputFieldSchema: () => Schema<HumanInputField> = defineSchema((v) =>
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

/** Zod schema for get human input request. */
export const getHumanInputRequestSchema: () => Schema<HumanInputRequest> = defineSchema((v) =>
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

/** Zod schema for get human input result. */
export const getHumanInputResultSchema: () => Schema<HumanInputResult> = defineSchema((v) =>
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

/** Zod schema for get human input pending request. */
export const getHumanInputPendingRequestSchema: () => Schema<HumanInputPendingRequest> =
  defineSchema((v) =>
    v.object({
      runId: getAgUiRuntimeRunIdSchema(),
      toolCallId: TOOL_CALL_ID_SCHEMA(v),
      request: getHumanInputRequestSchema(),
    })
  );

/** Public API contract for human input resume value. */
export type HumanInputResumeValue = {
  result: unknown;
  isError: boolean;
};

/** Result returned from durable human input flow. */
export type DurableHumanInputFlowResult<TCreatedRequest> = {
  result: HumanInputResult;
  createdRequest: TCreatedRequest;
};

/** Options accepted by execute durable human input flow. */
export interface ExecuteDurableHumanInputFlowOptions<
  TCreatedRequest,
  TSnapshot,
> {
  /** Session manager value. */
  sessionManager?: RunResumeSessionManager<HumanInputResumeValue> | undefined;
  /** Run ID value. */
  runId: string;
  /** Thread ID value. */
  threadId: string;
  /** Tool call ID value. */
  toolCallId: string;
  /** Request value. */
  request: HumanInputRequestInput;
  /** Timeout ms value. */
  timeoutMs: number;
  /** Poll interval ms value. */
  pollIntervalMs: number;
  /** On request value. */
  onRequest: (
    request: HumanInputPendingRequest,
  ) => TCreatedRequest | Promise<TCreatedRequest>;
  /** Callback invoked when created request. */
  onCreatedRequest?: ((request: TCreatedRequest) => void | Promise<void>) | undefined;
  /** Callback that handles get snapshot. */
  getSnapshot: (request: TCreatedRequest) => TSnapshot | Promise<TSnapshot>;
  /** Callback that handles resolve snapshot. */
  resolveSnapshot: (snapshot: TSnapshot) => HumanInputResult | undefined;
}

/** Options accepted by wait for durable human input resolution. */
export interface WaitForDurableHumanInputResolutionOptions<TSnapshot> {
  /** Deadline value. */
  deadline: number;
  /** Poll interval ms value. */
  pollIntervalMs: number;
  /** Callback that handles get snapshot. */
  getSnapshot: () => TSnapshot | Promise<TSnapshot>;
  /** Callback that handles resolve snapshot. */
  resolveSnapshot: (snapshot: TSnapshot) => HumanInputResult | undefined;
}

/** Options accepted by wait for human input. */
export interface WaitForHumanInputOptions {
  /** Session manager value. */
  sessionManager: RunResumeSessionManager<HumanInputResumeValue>;
  /** Run ID value. */
  runId: string;
  /** Tool call ID value. */
  toolCallId: string;
  /** Request value. */
  request: HumanInputRequestInput;
  /** Callback invoked when request. */
  onRequest?: ((request: HumanInputPendingRequest) => void | Promise<void>) | undefined;
}

/** Error shape for human input resume. */
export class HumanInputResumeError extends Error {
  /** Creates an instance with the supplied dependencies. */
  constructor(readonly detail: unknown) {
    super(
      typeof detail === "string" ? detail : "Human input resume failed",
    );
    this.name = "HumanInputResumeError";
  }
}

/** Error shape for invalid human input result. */
export class InvalidHumanInputResultError extends Error {
  /** Creates an instance with the supplied dependencies. */
  constructor(readonly detail: ValidationIssue[]) {
    super("Invalid human input resume payload");
    this.name = "InvalidHumanInputResultError";
  }
}

/** Execute durable human input flow. */
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
          throw AGENT_ERROR.create({
            detail: "Durable human input flow could not track the created request",
          });
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

/** Input payload for wait for human. */
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

/** Wait for durable human input resolution helper. */
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

  throw AGENT_TIMEOUT.create({
    detail: "Timed out while waiting for durable human input resolution",
  });
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
