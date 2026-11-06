/**
 * Tool approval (maker-checker).
 *
 * A tool declared with `approval` never runs until a person other than the one who started
 * the run approves that exact call. The host supplies the approval channel through the tool
 * execution context; without one the tool refuses to run.
 */
import { INVALID_ARGUMENT, PERMISSION_DENIED } from "#veryfront/errors";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
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

const REFUSAL_JSON_SCHEMA: JsonSchema = Object.freeze<JsonSchema>({
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
    anyOf: [outputSchemaJson, REFUSAL_JSON_SCHEMA],
  };
}

const MAX_STEP_UP_SECONDS = 86_400;
const MAX_EXPIRY_SECONDS = 7 * 86_400;

/** Validate an approval policy at definition time so a typo cannot silently disable it. */
export function snapshotToolApprovalPolicy(
  policy: unknown,
  toolId: string,
): ToolApprovalPolicy | undefined {
  if (policy === undefined) return undefined;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw INVALID_ARGUMENT.create({ detail: `Tool "${toolId}" approval must be an object` });
  }
  const record = policy as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "stepUpSeconds" && key !== "expiresInSeconds") {
      throw INVALID_ARGUMENT.create({
        detail: `Tool "${toolId}" approval has unknown key "${key}"`,
      });
    }
  }
  const seconds = (key: "stepUpSeconds" | "expiresInSeconds", max: number) => {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Tool "${toolId}" approval.${key} must be a whole number of seconds from 1 to ${max}`,
      });
    }
    return value;
  };
  const stepUpSeconds = seconds("stepUpSeconds", MAX_STEP_UP_SECONDS);
  const expiresInSeconds = seconds("expiresInSeconds", MAX_EXPIRY_SECONDS);
  return Object.freeze({
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
  if (decision.approved === true && decision.outcome === "approved") return undefined;
  // The model gets words it can relay; the checker's identity stays with the host's record.
  const message = decision.outcome === "denied"
    ? `The approver denied the ${toolName} call${
      decision.comment ? `: "${decision.comment}".` : "."
    } It did not run.`
    : decision.outcome === "expired"
    ? `Nobody approved the ${toolName} call in time. It did not run.`
    : `The ${toolName} call was withdrawn before approval. It did not run.`;
  return {
    status: "not_approved",
    // A decision that contradicts itself (approved, but not "approved") fails closed as a denial.
    outcome: decision.outcome === "approved" ? "denied" : decision.outcome,
    tool: toolName,
    ...(decision.comment ? { comment: decision.comment } : {}),
    message,
  };
}
