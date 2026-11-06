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
  /** Longest wait for any one API response before it counts as failed. */
  requestTimeoutMs?: number;
}

interface InputRequestResource {
  input_request_id: string;
  tool_call_id?: string | null;
  tool_call?: { name: string; arguments: unknown } | null;
  status: "open" | "submitted" | "cancelled" | "expired";
  expires_at?: string | null;
  response?: {
    values?: Record<string, unknown>;
    actor?: { type: string; id: string };
  } | null;
}

interface InputRequestPage {
  data?: InputRequestResource[];
  page_info?: { next?: string | null };
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Polls that keep failing past the request's expiry give up after this long, as expired. */
const EXPIRY_GRACE_MS = 60_000;
/** Pages of the run's requests read to find the one an earlier attempt opened. */
const MAX_RECOVERY_PAGES = 10;
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
  let base = options.apiUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const pollIntervalMs = positiveMs(
    "pollIntervalMs",
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const requestTimeoutMs = positiveMs(
    "requestTimeoutMs",
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const send = async (path: string, init: RequestInit = {}) => {
    // A response that never completes fails after the timeout instead of holding the call forever.
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await doFetch(`${base}${path}`, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        "Content-Type": "application/json",
        ...init.headers,
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
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const { response, body } = await send(path, init);
    if (!response.ok) throw failure(response, body);
    return body;
  };
  /** The request's latest state, or undefined when this poll failed in a way a later one may not. */
  const poll = async (path: string, signal?: AbortSignal) => {
    try {
      const { response, body } = await send(path, { signal });
      if (response.ok) return body as InputRequestResource;
      if (response.status !== 429 && response.status < 500) throw failure(response, body);
      agentLogger.warn("Tool approval poll failed; retrying", { status: response.status });
    } catch (error) {
      if (signal?.aborted || !isTransportFailure(error)) throw error;
      agentLogger.warn("Tool approval poll failed; retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  };
  /**
   * The request an earlier attempt at this call opened, in whatever state it is now (its response
   * was lost, or it asked with another expiry, so the key no longer replays). Only a request about
   * this exact call counts: an approval never carries over to other arguments.
   */
  const recover = async (
    runRequests: string,
    toolCallId: string,
    request: { toolName: string; input: unknown },
    signal?: AbortSignal,
  ) => {
    const matches: InputRequestResource[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_RECOVERY_PAGES; page++) {
      const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const listed = await call(`${runRequests}?${query}`, { signal }) as InputRequestPage;
      matches.push(
        ...(listed.data ?? []).filter((item) =>
          item.tool_call_id === toolCallId && item.tool_call?.name === request.toolName &&
          canonicalJson(item.tool_call.arguments) === canonicalJson(request.input)
        ),
      );
      cursor = listed.page_info?.next ?? undefined;
      if (!cursor) break;
    }
    return matches.find((item) => item.status === "open") ?? matches[0];
  };

  return async (request, signal) => {
    // Hosts that do not track tool call ids still need one durable anchor per gated call.
    const toolCallId = request.toolCallId ?? `approval-${crypto.randomUUID()}`;
    const expiresAt = Date.now() +
      (request.policy.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000;
    const runRequests = `/runs/${encodeURIComponent(options.runId)}/input-requests`;
    const callHash = await computeHash(`${options.runId}:${toolCallId}`);
    const { response, body } = await send(runRequests, {
      method: "POST",
      // Keyed by run and tool call, so a retry after a lost response gets the committed request
      // back instead of a conflict with it.
      headers: {
        "Idempotency-Key": `tool-approval:${callHash}`,
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
        expires_at: new Date(expiresAt).toISOString(),
      }),
    });
    let created: InputRequestResource;
    if (response.ok) {
      created = body as InputRequestResource;
    } else if (response.status === 409 || response.status === 422) {
      const existing = await recover(runRequests, toolCallId, request, signal);
      if (!existing) throw failure(response, body);
      created = existing;
    } else {
      throw failure(response, body);
    }
    const id = encodeURIComponent(created.input_request_id);
    const deadline = (created.expires_at ? Date.parse(created.expires_at) : expiresAt) +
      EXPIRY_GRACE_MS;
    let current = created;
    try {
      while (current.status === "open") {
        await wait(pollIntervalMs, signal);
        const latest = await poll(`/input-requests/${id}`, signal);
        if (latest) {
          current = latest;
        } else if (Date.now() > deadline) {
          // The API stopped answering past the request's expiry: the call does not run.
          return { approved: false, outcome: "expired", approvalId: created.input_request_id };
        }
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

function positiveMs(name: string, value: number | undefined, fallback: number): number {
  const ms = value ?? fallback;
  // Zero, negative or non-finite values would poll back to back or never wait at all.
  if (!Number.isFinite(ms) || ms <= 0) {
    throw INVALID_ARGUMENT.create({
      detail: `Approval ${name} must be a positive, finite number of milliseconds`,
    });
  }
  return ms;
}

/** A failure to reach the API at all (network or timeout), which a later poll may not hit. */
function isTransportFailure(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"));
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
      Object.keys(record).sort((left, right) => left.localeCompare(right)).map((key) =>
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
