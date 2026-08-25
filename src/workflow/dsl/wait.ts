import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { isCanonicalNonEmptyString, validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { INTERNAL_DELAY_EVENT_NAME, INTERNAL_WAIT_KIND_FIELD } from "../timed-wait-state.ts";

/** Options accepted by wait for approval. */
export interface WaitForApprovalOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  message?: string;
  payload?: unknown | ((context: WorkflowContext) => unknown);
  timeout?: string | number;
  approvers?: string[];
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
  /**
   * Shape the approver's structured answer must satisfy. Submitting a
   * non-conformant answer is refused instead of persisted.
   */
  responseSchema?: Schema<unknown>;
}

/** Create a wait-for-approval node. Pauses until human approves/rejects. */
export function waitForApproval(id: string, options: WaitForApprovalOptions = {}): WorkflowNode {
  validateNodeId(id);

  return {
    id,
    config: {
      type: "wait",
      description: options.description,
      waitType: "approval",
      message: options.message ?? "Approval required",
      payload: options.payload,
      approvers: options.approvers,
      ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
      timeout: options.timeout,
      checkpoint: true,
      retry: options.retry,
      skip: options.skip,
    },
  };
}

/** Options accepted by wait for event. */
export interface WaitForEventOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  eventName: string;
  timeout?: string | number;
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/** Create a wait-for-event node. Pauses until external event is received. */
export function waitForEvent(id: string, options: WaitForEventOptions): WorkflowNode {
  validateNodeId(id);

  if (!isCanonicalNonEmptyString(options.eventName)) {
    throw INVALID_ARGUMENT.create({ detail: `waitForEvent "${id}" must specify an eventName` });
  }
  // The reserved delay transport name would make this wait indistinguishable
  // from a delay(): the runtime would never release it through a published
  // event, and its timeout would complete the node instead of failing the run.
  if (options.eventName === INTERNAL_DELAY_EVENT_NAME) {
    throw INVALID_ARGUMENT.create({
      detail: `waitForEvent "${id}" cannot use the reserved event name ` +
        `"${INTERNAL_DELAY_EVENT_NAME}"; use delay() for a timed pause`,
    });
  }

  return {
    id,
    config: {
      type: "wait",
      description: options.description,
      waitType: "event",
      eventName: options.eventName,
      timeout: options.timeout,
      checkpoint: true,
      retry: options.retry,
      skip: options.skip,
    },
  };
}

/** Create a simple delay/sleep node. */
export function delay(id: string, duration: string | number): WorkflowNode {
  validateNodeId(id);

  return {
    id,
    config: {
      type: "wait",
      waitType: "event",
      eventName: INTERNAL_DELAY_EVENT_NAME,
      timeout: duration,
      checkpoint: false,
      // Explicit marker, so a delay stays a delay through definition capture
      // and persistence without leaning on the reserved-name fallback.
      [INTERNAL_WAIT_KIND_FIELD]: "delay",
    } as WorkflowNode["config"],
  };
}
