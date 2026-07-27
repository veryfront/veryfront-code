/**
 * Workflow Discovery Handler
 */

import type { Workflow } from "#veryfront/workflow";
import { registerWorkflow } from "#veryfront/workflow/registry.ts";
import type { DiscoveryHandler } from "../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStaticWorkflowNode(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isRecord(value.config)) {
    return false;
  }
  if (!isNonEmptyString(value.config.type)) return false;
  return value.dependsOn === undefined ||
    (Array.isArray(value.dependsOn) && value.dependsOn.every(isNonEmptyString));
}

function isDiscoverableWorkflow(item: unknown): item is Workflow {
  if (!isRecord(item) || !isNonEmptyString(item.id) || !isRecord(item.definition)) {
    return false;
  }

  const definition = item.definition;
  if (definition.id !== item.id) return false;
  return typeof definition.steps === "function" ||
    (Array.isArray(definition.steps) && definition.steps.every(isStaticWorkflowNode));
}

export const workflowHandler: DiscoveryHandler<Workflow> = {
  typeName: "workflow",
  validate: isDiscoverableWorkflow,
  getId: (workflow) => workflow.id,
  register: (_id, workflow) => {
    registerWorkflow(workflow);
    return workflow;
  },
  getResultMap: (result) => result.workflows,
};
