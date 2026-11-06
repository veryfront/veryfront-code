/**
 * Tool approval (maker-checker).
 *
 * A tool declared with `approval` never runs until a person other than the one who started
 * the run approves that exact call. The host supplies the approval channel through the tool
 * execution context; without one the tool refuses to run.
 */
import { INVALID_ARGUMENT, PERMISSION_DENIED } from "#veryfront/errors";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { isContractSchema } from "#veryfront/schemas/schema-input.ts";
import type { ToolExecutionContext } from "./types.ts";

/** How a tool asks for approval before it runs. */
export interface ToolApprovalPolicy {
  /** Require a checker who signed in within this many seconds. */
  stepUpSeconds?: number;
  /** How long the call waits for a decision. The platform default is 30 minutes. */
  expiresInSeconds?: number;
}

/** One gated call, as shown to the checker. */
export interface ToolApprovalRequest {
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  policy: ToolApprovalPolicy;
}

/** The checker's decision. */
export interface ToolApprovalDecision {
  approved: boolean;
  /** Why the call did not run: a checker denied it, nobody decided in time, or it was withdrawn. */
  outcome: "approved" | "denied" | "expired" | "withdrawn";
  checker?: { type: string; id: string };
  comment?: string;
  approvalId?: string;
}

/** Host-provided approval channel: resolves once the call is decided. */
export type ToolApprovalGate = (
  request: ToolApprovalRequest,
  signal?: AbortSignal,
) => Promise<ToolApprovalDecision>;

/**
 * The tool result the model sees when a call was not approved. It names no checker: who decided
 * stays in the approval record, never in what reaches the model provider.
 */
export interface ToolApprovalRefusal {
  status: "not_approved";
  outcome: Exclude<ToolApprovalDecision["outcome"], "approved">;
  tool: string;
  comment?: string;
  message: string;
}

/** A refusal's JSON contract, new per tool, so changing one tool's contract never changes another's. */
const refusalJsonSchema = (): JsonSchema => ({
  type: "object",
  properties: {
    status: { const: "not_approved" },
    outcome: { enum: ["denied", "expired", "withdrawn"] },
    tool: { type: "string" },
    comment: { type: "string" },
    message: { type: "string" },
  },
  required: ["status", "outcome", "tool", "message"],
  additionalProperties: false,
});

const getRefusalSchema = defineSchema((v) =>
  v.object({
    status: v.literal("not_approved"),
    outcome: v.enum(["denied", "expired", "withdrawn"] as const),
    tool: v.string(),
    comment: v.string().optional(),
    message: v.string(),
  }).strict()
);

/**
 * Widen a gated tool's native output validator so a refusal passes it too. The strict refusal is
 * tried first, so a lenient output schema never strips a refusal into something else.
 */
export function withToolApprovalRefusalSchema<T>(
  outputSchema: Schema<T> | undefined,
): Schema<T | ToolApprovalRefusal> | undefined {
  if (outputSchema === undefined) return undefined;
  return defineSchema((v) => v.union([getRefusalSchema(), outputSchema]))();
}

/**
 * Widen a gated tool's declared output so a refusal is a valid result. An object contract stays an
 * object at the root, which MCP requires to advertise it.
 */
export function withToolApprovalRefusal(
  outputSchemaJson: JsonSchema | undefined,
): JsonSchema | undefined {
  if (outputSchemaJson === undefined) return undefined;
  return {
    ...(outputSchemaJson.type === "object" ? { type: "object" } : {}),
    anyOf: [outputSchemaJson, refusalJsonSchema()],
  };
}

/**
 * A gated tool's output contracts, widened so a refusal is a valid result. A raw JSON contract has
 * no native validator to widen, so the widened JSON stands in for it.
 */
export function withToolApprovalRefusalOutput<T>(
  outputSchema: Schema<T> | undefined,
  outputSchemaJson: JsonSchema | undefined,
): {
  outputSchema: Schema<T | ToolApprovalRefusal> | undefined;
  outputSchemaJson: JsonSchema | undefined;
} {
  const widenedJson = withToolApprovalRefusal(outputSchemaJson);
  return {
    outputSchema: isContractSchema(outputSchema)
      ? withToolApprovalRefusalSchema(outputSchema as Schema<T>)
      : widenedJson as Schema<T | ToolApprovalRefusal> | undefined,
    outputSchemaJson: widenedJson,
  };
}

// Captured before project code runs, so a replaced global cannot leave a policy mutable or loosen it.
const objectFreeze = Object.freeze;
const objectKeys = Object.keys;
const isArray = Array.isArray;
const isInteger = Number.isInteger;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const signalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")!.get!;
const apply = Reflect.apply;

const MAX_STEP_UP_SECONDS = 86_400;
const MAX_EXPIRY_SECONDS = 7 * 86_400;

/** Validate an approval policy at definition time so a typo cannot silently disable it. */
export function snapshotToolApprovalPolicy(
  policy: unknown,
  toolId: string,
): ToolApprovalPolicy | undefined {
  if (policy === undefined) return undefined;
  if (policy === null || typeof policy !== "object" || isArray(policy)) {
    throw INVALID_ARGUMENT.create({ detail: `Tool "${toolId}" approval must be an object` });
  }
  const record = policy as Record<string, unknown>;
  const keys = objectKeys(record);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key !== "stepUpSeconds" && key !== "expiresInSeconds") {
      throw INVALID_ARGUMENT.create({
        detail: `Tool "${toolId}" approval has unknown key "${key}"`,
      });
    }
  }
  const seconds = (key: "stepUpSeconds" | "expiresInSeconds", max: number) => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !isInteger(value) || value <= 0 || value > max) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Tool "${toolId}" approval.${key} must be a whole number of seconds from 1 to ${max}`,
      });
    }
    return value;
  };
  const stepUpSeconds = seconds("stepUpSeconds", MAX_STEP_UP_SECONDS);
  const expiresInSeconds = seconds("expiresInSeconds", MAX_EXPIRY_SECONDS);
  return objectFreeze({
    ...(stepUpSeconds === undefined ? {} : { stepUpSeconds }),
    ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
  });
}

/**
 * Ask the host for a decision. Returns undefined when the call may run, or the refusal the
 * model should see instead. Fails closed when the host has no approval channel.
 */
export async function requireToolApproval(
  toolName: string,
  policy: ToolApprovalPolicy,
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<ToolApprovalRefusal | undefined> {
  const gate = context?.requestToolApproval;
  if (typeof gate !== "function") {
    throw PERMISSION_DENIED.create({
      detail: `Tool "${toolName}" requires approval, but this runtime has no approval channel`,
    });
  }
  const decision = await gate(
    { toolName, toolCallId: context?.toolCallId, input, policy },
    context?.abortSignal,
  );
  if (decision.approved === true && decision.outcome === "approved") {
    // A run cancelled while the approval was pending never runs the call, however the gate answered.
    const signal = context?.abortSignal;
    if (signal && apply(signalAborted, signal, [])) throw apply(signalReason, signal, []);
    return undefined;
  }
  // A decision that contradicts itself (approved, but not "approved") fails closed as a denial, and
  // both the outcome and its message come from that one normalized value.
  const outcome = decision.outcome === "approved" ? "denied" : decision.outcome;
  // The model gets words it can relay; the checker's identity stays with the host's record.
  const message = refusalMessage(toolName, outcome, decision.comment);
  return {
    status: "not_approved",
    outcome,
    tool: toolName,
    ...(decision.comment ? { comment: decision.comment } : {}),
    message,
  };
}

function refusalMessage(
  toolName: string,
  outcome: ToolApprovalRefusal["outcome"],
  comment: string | undefined,
): string {
  if (outcome === "expired") return `Nobody approved the ${toolName} call in time. It did not run.`;
  if (outcome === "withdrawn") {
    return `The ${toolName} call was withdrawn before approval. It did not run.`;
  }
  const note = comment ? `: "${comment}".` : ".";
  return `The approver denied the ${toolName} call${note} It did not run.`;
}
