/**
 * Approval channel backed by Veryfront input requests: each gated call becomes a decision form
 * on its run that someone other than the run's starter must answer, and the call waits for it.
 */
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils/logger/index.ts";
import type { ToolApprovalDecision, ToolApprovalGate } from "./approval.ts";

export interface InputRequestApprovalGateOptions {
  /** Veryfront API base URL. */
  apiUrl: string;
  /** Credential of the run's initiator; it may ask for approval but never grant it. */
  authToken: string;
  /** Canonical run the gated calls belong to. */
  runId: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
}

interface InputRequestResource {
  input_request_id: string;
  status: "open" | "submitted" | "cancelled" | "expired";
  response?: {
    values?: Record<string, unknown>;
    actor?: { type: string; id: string };
  } | null;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
/** How long a gated call waits for a decision when its policy names no expiry. */
const DEFAULT_EXPIRES_IN_SECONDS = 30 * 60;

const DECISION_FIELDS = [
  {
    name: "decision",
    type: "radio",
    label: "Decision",
    required: true,
    options: [
      { value: "approve", label: "Approve" },
      { value: "deny", label: "Deny" },
    ],
  },
  { name: "comment", type: "textarea", label: "Comment", required: false },
];

/** Create an approval channel that asks a checker through the run's input requests. */
export function createInputRequestApprovalGate(
  options: InputRequestApprovalGateOptions,
): ToolApprovalGate {
  const doFetch = options.fetch ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, "");
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const call = async (path: string, init: RequestInit = {}): Promise<InputRequestResource> => {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw INVALID_ARGUMENT.create({
        detail: `Approval request failed: HTTP ${response.status} ${
          (body as { detail?: string }).detail ?? ""
        }`.trim(),
      });
    }
    return body as InputRequestResource;
  };

  return async (request, signal) => {
    const created = await call(`/runs/${encodeURIComponent(options.runId)}/input-requests`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      signal,
      body: JSON.stringify({
        title: `Approve ${request.toolName}`,
        requested_responder_type: "human",
        // Hosts that do not track tool call ids still need one durable anchor per gated call.
        tool_call_id: request.toolCallId ?? `approval-${crypto.randomUUID()}`,
        fields: DECISION_FIELDS,
        responder_rules: {
          exclude_run_starters: true,
          required_capability: "project.approvals.decide",
          ...(request.policy.stepUpSeconds
            ? { step_up_seconds: request.policy.stepUpSeconds }
            : {}),
        },
        tool_call: { name: request.toolName, arguments: request.input },
        // This gate reads the decision itself; the gated call never parks for a tool result.
        delivery: "none",
        expires_at: new Date(
          Date.now() + (request.policy.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000,
        ).toISOString(),
      }),
    });
    const id = encodeURIComponent(created.input_request_id);
    let current = created;
    try {
      while (current.status === "open") {
        await wait(pollIntervalMs, signal);
        current = await call(`/input-requests/${id}`, { signal });
      }
    } catch (error) {
      // A cancelled run withdraws its pending approval so no checker can approve a dead call.
      if (signal?.aborted) {
        // Best effort: finalizing the run also cancels its open requests.
        await call(`/input-requests/${id}/cancel`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        }).catch((cancelError) =>
          agentLogger.warn("Could not withdraw the pending tool approval", {
            inputRequestId: created.input_request_id,
            error: cancelError instanceof Error ? cancelError.message : String(cancelError),
          })
        );
      }
      throw error;
    }
    return toDecision(current);
  };
}

function toDecision(request: InputRequestResource): ToolApprovalDecision {
  const approvalId = request.input_request_id;
  if (request.status === "expired") return { approved: false, outcome: "expired", approvalId };
  if (request.status === "cancelled") return { approved: false, outcome: "withdrawn", approvalId };
  const values = request.response?.values ?? {};
  const checker = request.response?.actor;
  const comment = typeof values.comment === "string" && values.comment.trim()
    ? values.comment.trim()
    : undefined;
  const decided = values.decision === "approve" ? "approved" : "denied";
  return {
    approved: decided === "approved",
    outcome: decided,
    approvalId,
    ...(checker ? { checker: { type: checker.type, id: checker.id } } : {}),
    ...(comment ? { comment } : {}),
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
