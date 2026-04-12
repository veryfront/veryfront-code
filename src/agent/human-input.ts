import { z } from "zod";
import { AgUiRuntimeRunIdSchema } from "./runtime-ag-ui-contract.ts";
import { RunResumeSessionManager } from "./runtime/index.ts";

const TOOL_CALL_ID_SCHEMA = z.string().min(1).max(128);

export const HumanInputOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  recommended: z.boolean().optional(),
});

const BaseHumanInputFieldSchema = z.object({
  name: z.string().min(1).max(128),
  label: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  required: z.boolean().optional().default(false),
  secret: z.boolean().optional().default(false),
});

export const HumanInputFieldSchema = z.discriminatedUnion("type", [
  BaseHumanInputFieldSchema.extend({
    type: z.enum(["text", "email", "url", "password", "number"]),
    placeholder: z.string().max(512).optional(),
    defaultValue: z.string().optional(),
    pattern: z.string().max(512).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  BaseHumanInputFieldSchema.extend({
    type: z.literal("textarea"),
    placeholder: z.string().max(512).optional(),
    defaultValue: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional().default(3),
  }),
  BaseHumanInputFieldSchema.extend({
    type: z.literal("select"),
    options: z.array(HumanInputOptionSchema).min(1),
    defaultValue: z.string().optional(),
    placeholder: z.string().max(512).optional(),
  }),
  BaseHumanInputFieldSchema.extend({
    type: z.literal("checkbox"),
    defaultValue: z.boolean().optional().default(false),
  }),
  BaseHumanInputFieldSchema.extend({
    type: z.literal("radio"),
    options: z.array(HumanInputOptionSchema).min(1),
    defaultValue: z.string().optional(),
  }),
  BaseHumanInputFieldSchema.extend({
    type: z.literal("confirm"),
    confirmLabel: z.string().max(64).optional().default("Yes"),
    denyLabel: z.string().max(64).optional().default("No"),
  }),
]);

export const HumanInputRequestSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  fields: z.array(HumanInputFieldSchema).min(1),
  submitLabel: z.string().max(64).optional().default("Submit"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const HumanInputResponseValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.number(), z.null()]),
);

export const HumanInputResultSchema = z.discriminatedUnion("submitted", [
  z.object({
    submitted: z.literal(true),
    values: HumanInputResponseValuesSchema,
  }),
  z.object({
    submitted: z.literal(false),
    values: HumanInputResponseValuesSchema.default({}),
  }),
]);

export const HumanInputPendingRequestSchema = z.object({
  runId: AgUiRuntimeRunIdSchema,
  toolCallId: TOOL_CALL_ID_SCHEMA,
  request: HumanInputRequestSchema,
});

export type HumanInputOption = z.infer<typeof HumanInputOptionSchema>;
export type HumanInputField = z.infer<typeof HumanInputFieldSchema>;
export type HumanInputFieldInput = z.input<typeof HumanInputFieldSchema>;
export type HumanInputRequest = z.infer<typeof HumanInputRequestSchema>;
export type HumanInputRequestInput = z.input<typeof HumanInputRequestSchema>;
export type HumanInputResult = z.infer<typeof HumanInputResultSchema>;
export type HumanInputPendingRequest = z.infer<typeof HumanInputPendingRequestSchema>;

type HumanInputResumeValue = {
  result: unknown;
  isError: boolean;
};

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
  constructor(readonly detail: z.ZodIssue[]) {
    super("Invalid human input resume payload");
    this.name = "InvalidHumanInputResultError";
  }
}

export async function waitForHumanInput(
  options: WaitForHumanInputOptions,
): Promise<HumanInputResult> {
  options.sessionManager.prepareForSignal(options.runId, options.toolCallId);
  const pendingRequest = HumanInputPendingRequestSchema.parse({
    runId: options.runId,
    toolCallId: options.toolCallId,
    request: options.request,
  });

  await options.onRequest?.(pendingRequest);

  const resumed = await options.sessionManager.waitForSignal(options.runId, options.toolCallId);
  if (resumed.isError) {
    throw new HumanInputResumeError(resumed.result);
  }

  const parsed = HumanInputResultSchema.safeParse(resumed.result);
  if (!parsed.success) {
    throw new InvalidHumanInputResultError(parsed.error.issues);
  }

  return parsed.data;
}
