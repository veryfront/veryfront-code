
import type {
  BaseNodeConfig,
  RetryConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

export interface WaitForApprovalOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  message?: string;
  payload?: unknown | ((context: WorkflowContext) => unknown);
  timeout?: string | number;
  approvers?: string[];
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function waitForApproval(
  id: string,
  options: WaitForApprovalOptions = {},
): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "approval",
    message: options.message ?? "Approval required",
    payload: options.payload,
    approvers: options.approvers,
    timeout: options.timeout,
    checkpoint: true,
    retry: options.retry,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

export interface WaitForEventOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  eventName: string;
  timeout?: string | number;
  retry?: RetryConfig;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function waitForEvent(
  id: string,
  options: WaitForEventOptions,
): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  if (!options.eventName) {
    throw new Error(`waitForEvent "${id}" must specify an eventName`);
  }

  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "event",
    eventName: options.eventName,
    timeout: options.timeout,
    checkpoint: true,
    retry: options.retry,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

export function delay(id: string, duration: string | number): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "event",
    eventName: "__delay__",
    timeout: duration,
    checkpoint: false,
  };

  return {
    id,
    config,
  };
}
