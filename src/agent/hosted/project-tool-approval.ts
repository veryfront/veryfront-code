import { joinPrivateAbortSignals } from "#veryfront/security/private-abort.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  observePrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type {
  ExecutorChannel,
  ExecutorOperation,
  ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import type { ToolApprovalGate } from "#veryfront/tool/approval.ts";
import type { ToolExecutionContext, ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import {
  EXECUTOR_TOOL_LIMITS,
  executorToolJson,
  getExecutorToolIdSchema,
  parseExecutorToolData,
} from "./executor-tool-schema.ts";

const approvalRequests = createPrivateWeakStore<object, true>();
/** The authenticated tool decoder marks only explicitly opted-in project calls. */
export function markProjectToolApprovalRequest(context: ToolExecutionContext): void {
  approvalRequests.set(context, true);
}
export function hasProjectToolApprovalRequest(context: ToolExecutionContext): boolean {
  return approvalRequests.get(context) === true;
}
const REQUEST_EVENT = "veryfront.tool-approval.request.v1";
export const PROJECT_TOOL_APPROVAL_DECISION = "project.tool-approval-decision";
export const PROJECT_TOOL_APPROVAL_REQUEST = "project.tool-approval-request";
const randomUUID = crypto.randomUUID.bind(crypto);
const now = Date.now;
const ApprovalAbortController = AbortController;
const getRequestSchema = defineSchema((v) =>
  v.object({
    type: v.literal(REQUEST_EVENT),
    approvalRequestId: v.string().uuid(),
    toolName: getExecutorToolIdSchema(),
    toolCallId: getExecutorToolIdSchema(),
    input: v.record(v.string(), getJsonValueSchema()),
    policy: v.object({
      stepUpSeconds: v.number().int().positive().optional(),
      expiresInSeconds: v.number().int().positive().optional(),
    }).strict(),
  }).strict()
);
const getRequestReferenceSchema = defineSchema((v) =>
  v.object({ approvalRequestId: v.string().uuid(), watch: v.boolean().optional() }).strict()
);
const getRequestNoticeSchema = defineSchema((v) =>
  v.object({
    type: v.literal(REQUEST_EVENT),
    approvalRequestId: v.string().uuid(),
    toolName: getExecutorToolIdSchema(),
    toolCallId: getExecutorToolIdSchema(),
  }).strict()
);
const getDecisionSchema = defineSchema((v) =>
  v.object({
    approved: v.boolean(),
    outcome: v.enum(["approved", "denied", "expired", "withdrawn"]),
    comment: v.string().max(32768).optional(),
    approvalId: getExecutorToolIdSchema().optional(),
  }).strict().refine(
    (value) => value.approved === (value.outcome === "approved"),
    "Invalid approval decision",
  )
);
const getReplySchema = defineSchema((v) =>
  v.object({
    approvalRequestId: v.string().uuid(),
    decision: getDecisionSchema(),
  }).strict()
);
const getAcknowledgementSchema = defineSchema((v) => v.object({ ok: v.literal(true) }).strict());

/** Materialize protocol schemas before loading project modules. */
export function warmProjectToolApprovalSchemas(): void {
  getRequestSchema();
  getRequestReferenceSchema();
  getRequestNoticeSchema();
  getDecisionSchema();
  getReplySchema();
  getAcknowledgementSchema();
}

/** The project can ask through its active tool stream; only its authenticated broker can deliver a decision. */
export function createProjectToolApprovalReceiver(scope: {
  binding: ExecutorBinding;
  signal: AbortSignal;
  assertActive(): void;
}, maxArgumentBytes = EXECUTOR_TOOL_LIMITS.maxArgumentBytes) {
  const binding = { ...scope.binding };
  type Decision = Awaited<ReturnType<ToolApprovalGate>>;
  const pending = createPrivateMap<string, {
    resolve(value: Decision): void;
    active(): void;
    decision?: Decision;
    request: unknown;
    closed: Promise<void>;
  }>();
  const authorize = (context: ExecutorOperationContext) => {
    scope.assertActive();
    scope.signal.throwIfAborted();
    context.signal.throwIfAborted();
    if (
      context.deadline <= now() || context.binding.allocationId !== binding.allocationId ||
      context.binding.invocationId !== binding.invocationId ||
      context.binding.generation !== binding.generation
    ) {
      throw new TypeError("Project approval binding mismatch");
    }
  };
  const requestOperation: ExecutorOperation = {
    mode: "unary",
    handle(value, context) {
      authorize(context);
      const reference = parseExecutorToolData(getRequestReferenceSchema(), value);
      const waiting = pending.get(reference.approvalRequestId);
      if (!waiting) throw new TypeError("Project approval is no longer pending");
      waiting.active();
      if (reference.watch) {
        const retired = createPrivateDeferred<{ closed: true }>();
        const abort = () => {
          context.signal.removeEventListener("abort", abort);
          retired.reject(new TypeError("Project approval observation cancelled"));
        };
        context.signal.addEventListener("abort", abort, { once: true });
        void chainPrivatePromise(waiting.closed, () => {
          context.signal.removeEventListener("abort", abort);
          retired.resolve({ closed: true });
        });
        if (context.signal.aborted) abort();
        return retired.promise;
      }
      return chainPrivatePromise(
        resolvePrivatePromise(),
        () => parseExecutorToolData(getRequestSchema(), waiting.request),
      );
    },
  };
  const operation: ExecutorOperation = {
    mode: "unary",
    handle(value, context) {
      authorize(context);
      const reply = parseExecutorToolData(getReplySchema(), value);
      const waiting = pending.get(reply.approvalRequestId);
      if (!waiting) throw new TypeError("Project approval is no longer pending");
      waiting.active();
      if (
        waiting.decision &&
        privateJsonStringify(waiting.decision) !== privateJsonStringify(reply.decision)
      ) {
        throw new TypeError("Project approval decision is already fixed");
      }
      waiting.decision = reply.decision;
      waiting.resolve(reply.decision);
      return chainPrivatePromise(resolvePrivatePromise(), () => ({ ok: true }));
    },
  };
  return {
    operation,
    requestOperation,
    forCall(toolName: string, context: ToolExecutionContext) {
      let closed = false;
      let requestId: string | undefined;
      let decision: ReturnType<typeof createPrivateDeferred<Decision>> | undefined;
      let signal = context.abortSignal
        ? joinPrivateAbortSignals(context.abortSignal, scope.signal)
        : scope.signal;
      let retirement: ReturnType<typeof createPrivateDeferred<void>> | undefined;
      const active = () => {
        scope.assertActive();
        scope.signal.throwIfAborted();
        signal.throwIfAborted();
        if (closed) throw new TypeError("Project tool approval call has ended");
      };
      const close = () => {
        closed = true;
        if (requestId) pending.delete(requestId);
        signal.removeEventListener("abort", abort);
        decision?.reject(new TypeError("Project tool approval call has ended"));
        retirement?.resolve();
      };
      const abort = () => close();
      const gate: ToolApprovalGate = async (request, requestSignal) => {
        active();
        if (decision) throw new TypeError("Project tool already requested approval for this call");
        if (requestSignal) signal = joinPrivateAbortSignals(signal, requestSignal);
        active();
        if (!context.toolCallId || !context.publishDataEvent) {
          throw new TypeError("Project tool approval stream is unavailable");
        }
        const event = parseExecutorToolData(getRequestSchema(), {
          type: REQUEST_EVENT,
          approvalRequestId: randomUUID(),
          toolName,
          toolCallId: context.toolCallId,
          input: executorToolJson(request.input, maxArgumentBytes),
          policy: request.policy,
        });
        requestId = event.approvalRequestId;
        decision = createPrivateDeferred<Decision>();
        // Observe rejection before publishing: cancellation may race the stream acknowledgement.
        void chainPrivatePromise(decision.promise, () => {}, () => {});
        retirement = createPrivateDeferred<void>();
        pending.set(requestId, {
          resolve: decision.resolve,
          active,
          request: event,
          closed: retirement.promise,
        });
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        try {
          // Keep the progress frame small. The authenticated broker reads the bounded
          // normalized arguments through the nonce rather than squeezing them into UI progress.
          const { input: _arguments, policy: _policy, ...notice } = event;
          await context.publishDataEvent(notice);
          active();
          return await observePrivatePromise(decision.promise);
        } finally {
          close();
        }
      };
      return { gate, close };
    },
  };
}

/** Consume the private request locally; neither it nor the checker's identity reaches model/UI progress. */
export async function handleProjectToolApproval(event: ToolExecutionDataEvent, input: {
  channel: Pick<ExecutorChannel, "request">;
  toolName: string;
  toolCallId: string | undefined;
  gate: ToolApprovalGate | undefined;
  signal?: AbortSignal;
  maxArgumentBytes?: number;
}): Promise<boolean> {
  if (event.type !== REQUEST_EVENT) return false;
  const notice = parseExecutorToolData(getRequestNoticeSchema(), event);
  if (notice.toolName !== input.toolName || notice.toolCallId !== input.toolCallId || !input.gate) {
    throw new TypeError("Project tool approval channel is unavailable");
  }
  input.signal?.throwIfAborted();
  const request = parseExecutorToolData(
    getRequestSchema(),
    await input.channel.request(PROJECT_TOOL_APPROVAL_REQUEST, {
      approvalRequestId: notice.approvalRequestId,
    }, { signal: input.signal }),
  );
  if (
    request.approvalRequestId !== notice.approvalRequestId || request.toolName !== input.toolName ||
    request.toolCallId !== input.toolCallId
  ) throw new TypeError("Project tool approval request changed");
  executorToolJson(request.input, input.maxArgumentBytes ?? EXECUTOR_TOOL_LIMITS.maxArgumentBytes);
  input.signal?.throwIfAborted();
  // The source can cancel a narrower request without ending its enclosing tool/run.
  // Observe that nonce's retirement on the same authenticated channel while the host gate waits.
  const retired = new ApprovalAbortController();
  const watcher = new ApprovalAbortController();
  const gateSignal = input.signal
    ? joinPrivateAbortSignals(input.signal, retired.signal)
    : retired.signal;
  const watchSignal = input.signal
    ? joinPrivateAbortSignals(input.signal, watcher.signal)
    : watcher.signal;
  const abortRetired = () => {
    if (!watcher.signal.aborted) {
      retired.abort(new TypeError("Project tool approval call has ended"));
    }
  };
  let observed: Promise<void> | undefined;
  try {
    observed = chainPrivatePromise(
      input.channel.request(PROJECT_TOOL_APPROVAL_REQUEST, {
        approvalRequestId: request.approvalRequestId,
        watch: true,
      }, { signal: watchSignal }),
      abortRetired,
      abortRetired,
    );
    gateSignal.throwIfAborted();
    const decision = await input.gate({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      input: request.input,
      policy: request.policy,
    }, gateSignal);
    gateSignal.throwIfAborted();
    const safeDecision = parseExecutorToolData(getDecisionSchema(), {
      approved: decision.approved,
      outcome: decision.outcome,
      ...(decision.comment === undefined ? {} : { comment: decision.comment }),
      ...(decision.approvalId === undefined ? {} : { approvalId: decision.approvalId }),
    });
    // request() settles only after the channel release acknowledgement; free the watch slot first.
    watcher.abort();
    await observePrivatePromise(observed);
    gateSignal.throwIfAborted();
    const acknowledgement = await input.channel.request(PROJECT_TOOL_APPROVAL_DECISION, {
      approvalRequestId: request.approvalRequestId,
      decision: safeDecision,
    }, { signal: input.signal });
    parseExecutorToolData(getAcknowledgementSchema(), acknowledgement);
    return true;
  } finally {
    watcher.abort();
    if (observed) await observePrivatePromise(observed);
  }
}
