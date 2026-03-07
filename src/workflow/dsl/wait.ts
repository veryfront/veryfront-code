import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

export interface WaitForApprovalOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  message?: string;
  payload?: unknown | ((context: WorkflowContext) => unknown);
  timeout?: string | number;
  approvers?: string[];
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/** Create a wait-for-approval node. Pauses until human approves/rejects. */
export function waitForApproval(id: string, options: WaitForApprovalOptions = {}): WorkflowNode {
  validateNodeId(id);

  return {
    id,
    config: {
      type: "wait",
      waitType: "approval",
      message: options.message ?? "Approval required",
      payload: options.payload,
      approvers: options.approvers,
      timeout: options.timeout,
      checkpoint: true,
      retry: options.retry,
      skip: options.skip,
    },
  };
}

export interface WaitForEventOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  eventName: string;
  timeout?: string | number;
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/** Create a wait-for-event node. Pauses until external event is received. */
export function waitForEvent(id: string, options: WaitForEventOptions): WorkflowNode {
  validateNodeId(id);

  if (!options.eventName) {
    throw INVALID_ARGUMENT.create({ detail: `waitForEvent "${id}" must specify an eventName` });
  }

  return {
    id,
    config: {
      type: "wait",
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
      eventName: "__delay__",
      timeout: duration,
      checkpoint: false,
    },
  };
}
