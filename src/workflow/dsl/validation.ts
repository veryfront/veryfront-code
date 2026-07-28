import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { RetryConfig, WorkflowNode, WorkflowNodeConfig } from "../types.ts";
import {
  parseDurationWithLabel,
  parsePositiveDurationWithLabel,
  validateRetryConfig,
} from "../types.ts";

interface ExecutionPolicy {
  retry?: RetryConfig;
  timeout?: string | number;
}

interface ValidatedExecutionPolicy {
  retry: RetryConfig | undefined;
  timeout: string | number | undefined;
}

/** Validate that a node ID is a non-empty string */
export function validateNodeId(id: string): void {
  if (!id.trim()) {
    throw INVALID_ARGUMENT.create({ detail: "Node ID must be a non-empty string" });
  }
}

/**
 * Validate and snapshot the timer policy shared by workflow definitions and
 * executable nodes. A snapshot prevents later caller mutation from bypassing
 * the checks performed while the definition is created.
 */
export function validateExecutionPolicy(
  label: string,
  policy: ExecutionPolicy,
): ValidatedExecutionPolicy {
  const retry = policy.retry;
  const timeout = policy.timeout;

  if (retry !== undefined) {
    validateRetryConfig(retry, `${label} retry`);
  }
  if (timeout !== undefined) {
    validatePositiveTimeout(timeout, `${label} timeout`);
  }

  return {
    retry: retry === undefined ? undefined : { ...retry },
    timeout,
  };
}

/** Validate a timeout that must remain strictly positive. */
export function validatePositiveTimeout(
  timeout: string | number,
  label: string,
): void {
  parsePositiveDurationWithLabel(timeout, label);
}

/** Validate a delay where numeric zero intentionally means no delay. */
export function validateDelay(
  delay: string | number,
  label: string,
): void {
  parseDurationWithLabel(delay, label);
}

/** Validate a positive safe-integer scheduling option. */
export function validatePositiveSafeInteger(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be a positive safe integer, got: ${value}`,
    });
  }
}

/** Namespace child IDs and every dependency reference into the same graph. */
export function namespaceWorkflowNodes(
  prefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  return rebaseWorkflowNodes("", prefix, nodes);
}

function rebaseWorkflowNodes(
  oldPrefix: string,
  newPrefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  const rebaseId = (id: string): string => {
    if (id.startsWith(newPrefix)) return id;
    if (id.startsWith(oldPrefix)) return `${newPrefix}${id.slice(oldPrefix.length)}`;
    return `${newPrefix}${id}`;
  };

  return nodes.map((node) => {
    const oldId = node.id;
    const newId = rebaseId(oldId);

    return {
      ...node,
      id: newId,
      config: rebaseCompositeDescendants(node.config, oldId, newId),
      ...(node.dependsOn === undefined
        ? {}
        : { dependsOn: node.dependsOn.map((dependency) => rebaseId(dependency)) }),
    };
  });
}

function rebaseCompositeDescendants(
  config: WorkflowNodeConfig,
  oldId: string,
  newId: string,
): WorkflowNodeConfig {
  switch (config.type) {
    case "parallel":
      return {
        ...config,
        nodes: rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.nodes),
      };
    case "branch":
      return {
        ...config,
        then: rebaseWorkflowNodes(
          `${oldId}/then/`,
          `${newId}/then/`,
          config.then,
        ),
        else: config.else === undefined ? undefined : rebaseWorkflowNodes(
          `${oldId}/else/`,
          `${newId}/else/`,
          config.else,
        ),
      };
    default:
      return config;
  }
}
