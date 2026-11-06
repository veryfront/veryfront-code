/**
 * Approval channel backed by Veryfront input requests: each gated call becomes a decision form
 * on its run that someone other than the run's starter must answer, and the call waits for it.
 */
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
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
  tool_call_id?: string | null;
  tool_call?: { name: string; arguments: unknown } | null;
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
  // Zero, negative or non-finite intervals would poll back to back and hit rate limits.
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval pollIntervalMs must be a positive, finite number of milliseconds",
    });
  }
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return { response, body: await response.json().catch(() => ({})) as unknown };
  };
  const failure = (response: Response, body: unknown) =>
    INVALID_ARGUMENT.create({
      detail: `Approval request failed: HTTP ${response.status} ${
        (body as { detail?: string }).detail ?? ""
      }`.trim(),
    });
  const call = async (path: string, init: RequestInit = {}): Promise<InputRequestResource> => {
    const { response, body } = await send(path, init);
    if (!response.ok) throw failure(response, body);
    return body as InputRequestResource;
  };

  return async (request, signal) => {
    // Hosts that do not track tool call ids still need one durable anchor per gated call.
    const toolCallId = request.toolCallId ?? `approval-${crypto.randomUUID()}`;
    const runRequests = `/runs/${encodeURIComponent(options.runId)}/input-requests`;
    const { response, body } = await send(runRequests, {
      method: "POST",
      // Keyed by run and tool call, so a retry after a lost response gets the committed request
      // back instead of a conflict with it.
      headers: {
        "Idempotency-Key": `tool-approval:${await computeHash(`${options.runId}:${toolCallId}`)}`,
      },
      signal,
      body: JSON.stringify({
        title: `Approve ${request.toolName}`,
        requested_responder_type: "human",
        tool_call_id: toolCallId,
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
    let created: InputRequestResource;
    if (response.ok) {
      created = body as InputRequestResource;
    } else if (response.status === 409 || response.status === 422) {
      // An earlier attempt at this call already opened its request (its response was lost, or it
      // asked with another expiry, so the key no longer replays). Wait on that request, but only if
      // it asks about this exact call: an approval never carries over to other arguments.
      const open = await call(`${runRequests}?status=open&limit=100`, { signal }) as unknown as {
        data?: InputRequestResource[];
      };
      const existing = open.data?.find((item) => item.tool_call_id === toolCallId);
      if (
        !existing || existing.tool_call?.name !== request.toolName ||
        canonicalJson(existing.tool_call.arguments) !== canonicalJson(request.input)
      ) {
        throw failure(response, body);
      }
      created = existing;
    } else {
      throw failure(response, body);
    }
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

/** JSON with object keys sorted, so arguments compare equal whatever order storage returns them in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      )
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
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
