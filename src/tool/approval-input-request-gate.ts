/**
 * Approval channel backed by Veryfront input requests: each gated call becomes a decision form
 * on its run that someone other than the run's starter must answer, and the call waits for it.
 */
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
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

interface ResponderRules {
  exclude_run_starters?: boolean;
  required_capability?: string;
  step_up_seconds?: number;
}

interface InputRequestResource {
  input_request_id: string;
  tool_call_id?: string | null;
  tool_call?: { name: string; arguments: unknown } | null;
  responder_rules?: ResponderRules | null;
  status: "open" | "submitted" | "cancelled" | "expired";
  created_at?: string | null;
  expires_at?: string | null;
  response?: {
    values?: Record<string, unknown>;
    // A historical response may carry no authenticated actor, only `type: "unavailable"`.
    actor?: { type: string; id?: string };
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
/** The Runs API's limit on a tool call id and a tool name. */
const MAX_RUNS_IDENTIFIER_LENGTH = 128;
/** How long a gated call waits for a decision when its policy names no expiry. */
const DEFAULT_EXPIRES_IN_SECONDS = 30 * 60;
/** The namespace of the tool call ids the gate makes up. */
const ANCHOR_PREFIX = "approval-";
/** Clock rounding the API may apply to a stored expiry. */
const EXPIRY_TOLERANCE_MS = 1000;

/** Whether a stored request stays open no longer than `windowMs` after it was asked. */
function withinWindow(item: InputRequestResource, windowMs: number): boolean {
  if (!item.created_at || !item.expires_at) return false;
  return dateParse(item.expires_at) - dateParse(item.created_at) <=
    windowMs + EXPIRY_TOLERANCE_MS;
}

// Captured before project code runs: what the checker sees, what recovery compares and where the gate
// sends its requests must not depend on globals project code can replace.
const nativeFetch = fetch;
const responseText = Response.prototype.text;
const apply = Reflect.apply;
const isArray = Array.isArray;
const objectKeys = Object.keys;
const arrayMap = Array.prototype.map;
const arraySort = Array.prototype.sort;
const arrayJoin = Array.prototype.join;
const dateParse = Date.parse;
const dateNow = Date.now;
const numberIsFinite = Number.isFinite;
const stringStartsWith = String.prototype.startsWith;
const stringEndsWith = String.prototype.endsWith;
const stringSlice = String.prototype.slice;
const NativeSet = Set;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const randomUUID = crypto.randomUUID.bind(crypto);

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
  const doFetch = options.fetch ?? nativeFetch;
  let base = options.apiUrl;
  while (apply(stringEndsWith, base, ["/"])) base = apply(stringSlice, base, [0, -1]) as string;
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
    const text = await (apply(responseText, response, []) as Promise<string>).catch(() => "");
    let body: unknown = {};
    try {
      body = privateJsonParse(text);
    } catch { /* A body that is not JSON reads as empty. */ }
    return { response, body };
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
    rules: ResponderRules,
    windowMs: number,
    signal?: AbortSignal,
  ) => {
    let open: InputRequestResource | undefined;
    let first: InputRequestResource | undefined;
    const seen = new NativeSet<string>();
    let cursor: string | undefined;
    // The whole run is read: the list has no tool call filter, and an older request still counts.
    do {
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const listed = await call(`${runRequests}?limit=100${cursorParam}`, {
        signal,
      }) as InputRequestPage;
      const items = listed.data ?? [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const matches = item.tool_call_id === toolCallId &&
          item.tool_call?.name === request.toolName &&
          canonicalJson(item.tool_call.arguments) === canonicalJson(request.input) &&
          // A request asked under another policy (a shorter step-up, say) never stands in for this one.
          sameRules(item.responder_rules, rules) &&
          // Nor does one that stayed open longer than this call's expiry allows.
          withinWindow(item, windowMs);
        if (!matches) continue;
        first ??= item;
        if (item.status === "open") open ??= item;
      }
      cursor = listed.page_info?.next ?? undefined;
      if (cursor && apply(setHas, seen, [cursor])) {
        throw INVALID_ARGUMENT.create({ detail: "Approval recovery read a repeating page cursor" });
      }
      if (cursor) apply(setAdd, seen, [cursor]);
    } while (cursor);
    return open ?? first;
  };

  return async (request, signal) => {
    if (request.toolName.length > MAX_RUNS_IDENTIFIER_LENGTH) {
      throw INVALID_ARGUMENT.create({
        detail: `Tool "${
          request.toolName.slice(0, 32)
        }…" cannot ask for approval: its name exceeds ${MAX_RUNS_IDENTIFIER_LENGTH} characters`,
      });
    }
    // Hosts that do not track tool call ids still need one durable anchor per gated call, and a
    // host id longer than the Runs API accepts is anchored by its hash, which a retry repeats. A
    // host id in the anchors' own namespace is hashed too, so no host id can take another's anchor.
    const toolCallId = request.toolCallId === undefined
      ? `${ANCHOR_PREFIX}${randomUUID()}`
      : request.toolCallId.length > MAX_RUNS_IDENTIFIER_LENGTH ||
          apply(stringStartsWith, request.toolCallId, [ANCHOR_PREFIX])
      ? `${ANCHOR_PREFIX}${await computeHash(request.toolCallId)}`
      : request.toolCallId;
    const windowMs = (request.policy.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000;
    const expiresAt = dateNow() + windowMs;
    const runRequests = `/runs/${encodeURIComponent(options.runId)}/input-requests`;
    const callHash = await computeHash(`${options.runId}:${toolCallId}`);
    const rules: ResponderRules = {
      exclude_run_starters: true,
      required_capability: "project.approvals.decide",
      ...(request.policy.stepUpSeconds ? { step_up_seconds: request.policy.stepUpSeconds } : {}),
    };
    const { response, body } = await send(runRequests, {
      method: "POST",
      // Keyed by run and tool call, so a retry after a lost response gets the committed request
      // back instead of a conflict with it.
      headers: {
        "Idempotency-Key": `tool-approval:${callHash}`,
      },
      signal,
      body: privateJsonStringify({
        title: `Approve ${request.toolName}`,
        requested_responder_type: "human",
        tool_call_id: toolCallId,
        fields: DECISION_FIELDS,
        responder_rules: rules,
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
      const existing = await recover(runRequests, toolCallId, request, rules, windowMs, signal);
      if (!existing) throw failure(response, body);
      created = existing;
    } else {
      throw failure(response, body);
    }
    const id = encodeURIComponent(created.input_request_id);
    const deadline = (created.expires_at ? dateParse(created.expires_at) : expiresAt) +
      EXPIRY_GRACE_MS;
    let current = created;
    try {
      while (current.status === "open") {
        await wait(pollIntervalMs, signal);
        const latest = await poll(`/input-requests/${id}`, signal);
        if (latest) {
          current = latest;
        } else if (dateNow() > deadline) {
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
          headers: { "Idempotency-Key": randomUUID() },
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
  if (!numberIsFinite(ms) || ms <= 0) {
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
  const actor = request.response?.actor;
  // A response without an authenticated actor names no checker rather than an empty one.
  const checker = actor?.id ? { type: actor.type, id: actor.id } : undefined;
  const comment = typeof values.comment === "string" && values.comment.trim()
    ? values.comment.trim()
    : undefined;
  const decided = values.decision === "approve" ? "approved" : "denied";
  return {
    approved: decided === "approved",
    outcome: decided,
    approvalId,
    ...(checker ? { checker } : {}),
    ...(comment ? { comment } : {}),
  };
}

/** Whether a stored request was asked under exactly these rules. */
function sameRules(stored: ResponderRules | null | undefined, wanted: ResponderRules): boolean {
  return (stored?.exclude_run_starters ?? false) === (wanted.exclude_run_starters ?? false) &&
    (stored?.required_capability ?? null) === (wanted.required_capability ?? null) &&
    (stored?.step_up_seconds ?? null) === (wanted.step_up_seconds ?? null);
}

/** JSON with object keys sorted, so arguments compare equal whatever order storage returns them in. */
function canonicalJson(value: unknown): string {
  if (isArray(value)) {
    return `[${
      apply(arrayJoin, apply(arrayMap, value, [(item: unknown) => canonicalJson(item)]), [","])
    }]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = apply(arraySort, objectKeys(record), []) as string[];
    const entries = apply(arrayMap, keys, [
      (key: string) => `${privateJsonStringify(key)}:${canonicalJson(record[key])}`,
    ]);
    return `{${apply(arrayJoin, entries, [","])}}`;
  }
  return privateJsonStringify(value) ?? "undefined";
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
