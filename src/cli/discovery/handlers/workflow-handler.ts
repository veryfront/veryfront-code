/**
 * Workflow Discovery Handler
 */

import type { Workflow } from "#veryfront/workflow";
import { registerWorkflow } from "#veryfront/workflow";
import type { DiscoveryHandler } from "../types.ts";

export const workflowHandler: DiscoveryHandler<Workflow> = {
  typeName: "workflow",
  validate: (item): item is Workflow =>
    item !== null &&
    typeof item === "object" &&
    "definition" in item &&
    "id" in item &&
    typeof (item as Workflow).id === "string",
  getId: (workflow) => workflow.id,
  register: (_id, workflow) => {
    registerWorkflow(workflow);
    return workflow;
  },
  getResultMap: (result) => result.workflows,
};
