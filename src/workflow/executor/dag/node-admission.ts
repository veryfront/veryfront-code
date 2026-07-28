import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowDefinition, WorkflowNode } from "../../types.ts";
import {
  parseDurationWithLabel,
  parsePositiveDurationWithLabel,
  validateRetryConfig,
} from "../../types.ts";

const MAX_LOOP_ITERATIONS = 100;

export interface NodeAdmissionFailure {
  nodeId: string;
  error: Error;
}

/** Validate supported runtime policy and scheduling options without invoking user code. */
export function validateRuntimeNodeOptions(node: WorkflowNode): void {
  const config = node.config;

  switch (config.type) {
    case "step":
      if (config.retry !== undefined) validateRetryConfig(config.retry);
      if (config.timeout !== undefined) {
        parsePositiveDurationWithLabel(config.timeout, `Step "${node.id}" timeout`);
      }
      return;
    case "parallel":
    case "map":
    case "branch":
    case "subWorkflow":
    case "loop":
      if (config.retry !== undefined) validateRetryConfig(config.retry);
      if (config.timeout !== undefined) {
        parsePositiveDurationWithLabel(
          config.timeout,
          `Composite node "${node.id}" timeout`,
        );
      }
      break;
  }

  if (config.type === "map" && config.concurrency !== undefined) {
    if (!Number.isSafeInteger(config.concurrency) || config.concurrency < 1) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Map node "${node.id}" maxConcurrency must be a positive safe integer, got: ${config.concurrency}`,
      });
    }
  }

  if (config.type !== "loop") return;

  if (!Number.isSafeInteger(config.maxIterations) || config.maxIterations < 1) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Loop "${node.id}" maxIterations must be a positive safe integer, got: ${config.maxIterations}`,
    });
  }
  if (config.maxIterations > MAX_LOOP_ITERATIONS) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Loop "${node.id}" maxIterations cannot exceed ${MAX_LOOP_ITERATIONS} (got ${config.maxIterations})`,
    });
  }
  if (config.delay !== undefined) {
    parseDurationWithLabel(config.delay, `Loop "${node.id}" delay`);
  }
}

/** Return the first invalid policy in the complete statically available node tree. */
export function findStaticNodeAdmissionFailure(
  nodes: WorkflowNode[],
): NodeAdmissionFailure | undefined {
  for (const node of nodes) {
    try {
      validateRuntimeNodeOptions(node);
    } catch (caught) {
      return {
        nodeId: node.id,
        error: caught instanceof Error ? caught : new Error(String(caught)),
      };
    }

    const nestedFailure = findNestedAdmissionFailure(node);
    if (nestedFailure) return nestedFailure;
  }

  return undefined;
}

function findNestedAdmissionFailure(node: WorkflowNode): NodeAdmissionFailure | undefined {
  const config = node.config;

  switch (config.type) {
    case "parallel":
      return findStaticNodeAdmissionFailure(config.nodes);
    case "branch":
      return findStaticNodeAdmissionFailure(config.then) ??
        findStaticNodeAdmissionFailure(config.else ?? []);
    case "loop":
      return typeof config.steps === "function"
        ? undefined
        : findStaticNodeAdmissionFailure(config.steps);
    case "subWorkflow":
      return typeof config.workflow === "string" || typeof config.workflow.steps === "function"
        ? undefined
        : findStaticNodeAdmissionFailure(config.workflow.steps);
    case "map":
      return isWorkflowDefinition(config.processor)
        ? (typeof config.processor.steps === "function"
          ? undefined
          : findStaticNodeAdmissionFailure(config.processor.steps))
        : findStaticNodeAdmissionFailure([config.processor]);
    default:
      return undefined;
  }
}

function isWorkflowDefinition(processor: unknown): processor is WorkflowDefinition {
  return typeof processor === "object" && processor !== null && "steps" in processor;
}
