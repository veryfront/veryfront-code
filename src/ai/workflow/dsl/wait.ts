/**
 * Wait DSL Builder
 *
 * Creates wait nodes for approvals and external events
 */

import type {
  BaseNodeConfig,
  RetryConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

/**
 * Options for creating a wait-for-approval node
 */
export interface WaitForApprovalOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** Message to display to the approver */
  message?: string;
  /** Payload to include with the approval request */
  payload?: unknown | ((context: WorkflowContext) => unknown);
  /** Timeout for the approval (e.g., "24h", "7d") */
  timeout?: string | number;
  /** Restrict approval to specific users */
  approvers?: string[];
  /** Retry configuration (for timeout/retry scenarios) */
  retry?: RetryConfig;
  /** Condition to skip this approval */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a wait-for-approval node
 *
 * This pauses the workflow until a human approves or rejects.
 * The workflow can be resumed via the approval API.
 *
 * @example
 * ```typescript
 * // Basic approval
 * waitForApproval('content-review', {
 *   message: 'Please review the generated content',
 *   timeout: '24h',
 * })
 *
 * // Approval with payload for context
 * waitForApproval('deployment-approval', {
 *   message: 'Approve deployment to production?',
 *   payload: (ctx) => ({
 *     changes: ctx['summarize'].output,
 *     riskLevel: ctx['analyze'].output.riskLevel,
 *   }),
 *   approvers: ['ops@company.com', 'lead@company.com'],
 *   timeout: '48h',
 * })
 * ```
 */
export function waitForApproval(
  id: string,
  options: WaitForApprovalOptions = {},
): WorkflowNode {
  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "approval",
    message: options.message ?? "Approval required",
    payload: options.payload,
    approvers: options.approvers,
    timeout: options.timeout,
    // Always checkpoint before waiting
    checkpoint: true,
    retry: options.retry,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

/**
 * Options for creating a wait-for-event node
 */
export interface WaitForEventOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** Event name to wait for */
  eventName: string;
  /** Timeout for the event (e.g., "1h", "7d") */
  timeout?: string | number;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Condition to skip this wait */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a wait-for-event node
 *
 * This pauses the workflow until an external event is received.
 * Events can be sent via the workflow event API.
 *
 * @example
 * ```typescript
 * // Wait for external webhook
 * waitForEvent('payment-confirmation', {
 *   eventName: 'payment.completed',
 *   timeout: '30m',
 * })
 *
 * // Wait for manual trigger
 * waitForEvent('manual-continue', {
 *   eventName: 'workflow.continue',
 * })
 * ```
 */
export function waitForEvent(
  id: string,
  options: WaitForEventOptions,
): WorkflowNode {
  if (!options.eventName) {
    throw new Error(`waitForEvent "${id}" must specify an eventName`);
  }

  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "event",
    eventName: options.eventName,
    timeout: options.timeout,
    // Always checkpoint before waiting
    checkpoint: true,
    retry: options.retry,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

/**
 * Create a simple delay/sleep node
 *
 * @example
 * ```typescript
 * // Wait for 5 minutes between steps
 * delay('cooldown', '5m')
 * ```
 */
export function delay(id: string, duration: string | number): WorkflowNode {
  const config: WaitNodeConfig = {
    type: "wait",
    waitType: "event",
    eventName: "__delay__",
    timeout: duration,
    checkpoint: false, // No need to checkpoint for simple delays
  };

  return {
    id,
    config,
  };
}
