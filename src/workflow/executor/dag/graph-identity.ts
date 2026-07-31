import type {
  MapNodeConfig,
  WorkflowDefinition,
  WorkflowGraphCompositeIdentity,
  WorkflowGraphIdentity,
  WorkflowGraphIdentityNode,
  WorkflowNode,
} from "../../types.ts";
import { canonicalizeWorkflowNodes } from "./node-identity.ts";

function isWorkflowDefinition(
  processor: MapNodeConfig["processor"],
): processor is WorkflowDefinition {
  return Object.hasOwn(processor, "steps");
}

function captureCompositeIdentity(node: WorkflowNode): WorkflowGraphCompositeIdentity | null {
  const config = node.config;
  switch (config.type) {
    case "parallel":
      return {
        kind: "parallel",
        strategy: config.strategy ?? null,
        nodes: captureGraphIdentity(config.nodes),
      };
    case "branch":
      return {
        kind: "branch",
        then: captureGraphIdentity(config.then),
        else: config.else === undefined ? null : captureGraphIdentity(config.else),
      };
    case "loop":
      return {
        kind: "loop",
        dynamic: typeof config.steps === "function",
        nodes: typeof config.steps === "function" ? null : captureGraphIdentity(config.steps),
      };
    case "map": {
      if (isWorkflowDefinition(config.processor)) {
        return {
          kind: "map",
          processorKind: "workflow",
          processorId: config.processor.id,
          processorVersion: config.processor.version ?? null,
          dynamic: typeof config.processor.steps === "function",
          nodes: typeof config.processor.steps === "function"
            ? null
            : captureGraphIdentity(config.processor.steps),
        };
      }
      return {
        kind: "map",
        processorKind: "node",
        processorId: config.processor.id,
        processorVersion: null,
        dynamic: false,
        nodes: captureGraphIdentity([config.processor]),
      };
    }
    case "subWorkflow": {
      if (typeof config.workflow === "string") {
        return {
          kind: "subWorkflow",
          workflowId: config.workflow,
          workflowVersion: null,
          dynamic: true,
          nodes: null,
        };
      }
      return {
        kind: "subWorkflow",
        workflowId: config.workflow.id,
        workflowVersion: config.workflow.version ?? null,
        dynamic: typeof config.workflow.steps === "function",
        nodes: typeof config.workflow.steps === "function"
          ? null
          : captureGraphIdentity(config.workflow.steps),
      };
    }
    default:
      return null;
  }
}

function captureGraphIdentity(nodes: readonly WorkflowNode[]): WorkflowGraphIdentity {
  return nodes.map((node): WorkflowGraphIdentityNode => ({
    id: node.id,
    type: node.config.type,
    dependsOn: node.dependsOn === undefined ? null : [...node.dependsOn],
    composite: captureCompositeIdentity(node),
  }));
}

/** Capture the ordered, function-free structural identity used for durable recovery. */
export function captureCanonicalWorkflowGraphIdentity(
  nodes: WorkflowNode[],
): WorkflowGraphIdentity {
  return captureGraphIdentity(canonicalizeWorkflowNodes(nodes));
}
