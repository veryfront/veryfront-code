/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution.
 *
 * @module ai/workflow/executor/dag
 */

import type {
  BranchNodeConfig,
  NodeState,
  ParallelNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../../types.ts";
import { generateId } from "../../types.ts";
import {
  cloneCheckpointForPersistence,
  cloneOwnedCheckpointForPersistence,
} from "../../backends/checkpoint-retention.ts";
import {
  captureWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../../source-integration-policy.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED, ORCHESTRATION_ERROR } from "#veryfront/errors";
import type { CheckpointOwnership } from "../checkpoint-manager.ts";

export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.ts";

import type {
  ContextPatch,
  DAGExecutionResult,
  DAGExecutorConfig,
  DAGExecutorInternalConfig,
  DAGInternalExecutionResult,
  ExecutionScope,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";
import { executeLoopNodeStrategy } from "./loop-node-strategy.ts";
import {
  setActiveSpanAttributes,
  setActiveSpanErrorStatus,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { executeMapNodeStrategy } from "./map-node-strategy.ts";
import {
  collectWorkflowNodeIds,
  namespaceWorkflowDefinition,
  rebaseCompositeDescendants,
} from "#veryfront/workflow/dsl/validation.ts";
import type { ChildGraphExecutionOptions } from "./node-strategy-types.ts";
import {
  executeCompositeNodeWithPolicy,
  isOwnershipLossError,
} from "./composite-node-execution.ts";
import {
  applyContextPatch,
  applyRecordPatch,
  cloneExecutionState,
  createContextPatch,
  createRecordPatch,
  createSetContextPatch,
  mergeContextPatches,
} from "./context-patch.ts";

const RESUMABLE_COMPOSITE_TYPES = new Set(["branch", "parallel", "map", "loop", "subWorkflow"]);
const MAX_STALLED_GRAPH_NODE_DETAILS = 10;
const NumberPrototypeToString = Number.prototype.toString;
const ReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypePadStart = String.prototype.padStart;

function encodeSubWorkflowOwnerSegment(nodeId: string): string {
  // Node IDs are arbitrary canonical strings and can contain slashes or lone
  // UTF-16 surrogates. Encode every code unit into a fixed-width segment so the
  // mapping is total, injective, and unambiguous when owner segments are joined.
  let encoded = "";
  for (let index = 0; index < nodeId.length; index += 1) {
    const codeUnit = ReflectApply(StringPrototypeCharCodeAt, nodeId, [index]) as number;
    const hex = ReflectApply(NumberPrototypeToString, codeUnit, [16]) as string;
    encoded += ReflectApply(StringPrototypePadStart, hex, [4, "0"]) as string;
  }
  return encoded;
}

function subWorkflowOwnerPath(parentPath: string, nodeId: string): string {
  const segment = encodeSubWorkflowOwnerSegment(nodeId);
  return parentPath ? `${parentPath}/${segment}` : segment;
}

function mergeSubWorkflowReservation(
  ownerPath: string,
  childIds: Set<string>,
  reservations: Map<string, Set<string>>,
): void {
  const existing = reservations.get(ownerPath);
  if (!existing) {
    reservations.set(ownerPath, childIds);
    return;
  }
  for (const childId of childIds) existing.add(childId);
}

function collectBranchOwnerPaths(
  nodes: readonly WorkflowNode[],
  parentPath: string,
  target: Map<string, Set<string>>,
): void {
  for (const node of nodes) {
    switch (node.config.type) {
      case "subWorkflow": {
        if (
          typeof node.config.workflow === "string" ||
          !Array.isArray(node.config.workflow.steps)
        ) break;
        collectBranchOwnerPaths(
          node.config.workflow.steps,
          subWorkflowOwnerPath(parentPath, node.id),
          target,
        );
        break;
      }
      case "branch": {
        const owners = target.get(node.id) ?? new Set<string>();
        owners.add(parentPath);
        target.set(node.id, owners);
        collectBranchOwnerPaths(node.config.then, parentPath, target);
        collectBranchOwnerPaths(node.config.else ?? [], parentPath, target);
        break;
      }
      case "parallel":
        collectBranchOwnerPaths(node.config.nodes, parentPath, target);
        break;
      case "loop":
        if (Array.isArray(node.config.steps)) {
          collectBranchOwnerPaths(node.config.steps, parentPath, target);
        }
        break;
      case "map": {
        const wrapperNodes = collectStaticMapWrapperNodes(node);
        if (wrapperNodes) collectBranchOwnerPaths(wrapperNodes, parentPath, target);
        break;
      }
    }
  }
}

function narrowReservationsToSelectedBranches(
  nodes: WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
  reservations: Set<string>,
  ownerPath: string,
  branchOwnerPaths: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const node of nodes) {
    switch (node.config.type) {
      case "parallel":
        narrowReservationsToSelectedBranches(
          node.config.nodes,
          nodeStates,
          reservations,
          ownerPath,
          branchOwnerPaths,
        );
        break;
      case "branch": {
        const branchState = nodeStates[node.id];
        const persistedOwner = branchState?._subWorkflowOwnerPath;
        const ambiguousOwnerlessState = persistedOwner === undefined &&
          (branchOwnerPaths.get(node.id)?.size ?? 0) > 1;
        if (ambiguousOwnerlessState) {
          for (
            const childId of collectSubWorkflowNodeIds([
              ...node.config.then,
              ...(node.config.else ?? []),
            ], nodeStates)
          ) {
            reservations.delete(childId);
          }
          break;
        }
        const stateBelongsToOwner = persistedOwner === undefined
          ? true
          : isSubWorkflowDescendant(persistedOwner, ownerPath);
        const output = stateBelongsToOwner ? branchState?.output : undefined;
        const selected = typeof output === "object" && output !== null && "branch" in output
          ? (output as { branch?: unknown }).branch
          : undefined;
        if (selected !== "then" && selected !== "else") {
          narrowReservationsToSelectedBranches(
            node.config.then,
            nodeStates,
            reservations,
            ownerPath,
            branchOwnerPaths,
          );
          narrowReservationsToSelectedBranches(
            node.config.else ?? [],
            nodeStates,
            reservations,
            ownerPath,
            branchOwnerPaths,
          );
          break;
        }
        const selectedNodes = selected === "then" ? node.config.then : (node.config.else ?? []);
        const unselectedNodes = selected === "then" ? (node.config.else ?? []) : node.config.then;
        const selectedIds = collectSubWorkflowNodeIds(selectedNodes, nodeStates);
        for (const childId of collectSubWorkflowNodeIds(unselectedNodes, nodeStates)) {
          if (!selectedIds.has(childId)) reservations.delete(childId);
        }
        narrowReservationsToSelectedBranches(
          selectedNodes,
          nodeStates,
          reservations,
          ownerPath,
          branchOwnerPaths,
        );
        break;
      }
      case "loop":
        if (Array.isArray(node.config.steps)) {
          narrowReservationsToSelectedBranches(
            node.config.steps,
            nodeStates,
            reservations,
            ownerPath,
            branchOwnerPaths,
          );
        }
        break;
      case "subWorkflow":
        if (
          typeof node.config.workflow !== "string" &&
          Array.isArray(node.config.workflow.steps)
        ) {
          const nestedOwnerPath = subWorkflowOwnerPath(ownerPath, node.id);
          const nestedState = nodeStates[node.id];
          const nestedStateOwner = nestedState?._subWorkflowOwnerPath;
          const nestedStateBelongsToOwner = nestedStateOwner === undefined ||
            isSubWorkflowDescendant(nestedStateOwner, nestedOwnerPath);
          if (nestedStateBelongsToOwner && nestedState?.status === "skipped") {
            for (
              const childId of collectSubWorkflowNodeIds(node.config.workflow.steps, nodeStates)
            ) {
              reservations.delete(childId);
            }
            break;
          }
          narrowReservationsToSelectedBranches(
            node.config.workflow.steps,
            nodeStates,
            reservations,
            nestedOwnerPath,
            branchOwnerPaths,
          );
        }
        break;
    }
  }
}

function collectStaticSubWorkflowReservation(
  node: WorkflowNode,
  parentPath: string,
  reservations: Map<string, Set<string>>,
  owners: Map<string, string>,
  nodeStates: Readonly<Record<string, NodeState>>,
  branchOwnerPaths: ReadonlyMap<string, ReadonlySet<string>>,
  ancestorOwnerStatus?: NodeState["status"],
): void {
  switch (node.config.type) {
    case "parallel":
      collectStaticSubWorkflowReservations(
        node.config.nodes,
        parentPath,
        reservations,
        owners,
        nodeStates,
        branchOwnerPaths,
        ancestorOwnerStatus,
      );
      return;
    case "branch":
      collectStaticSubWorkflowReservations(
        node.config.then,
        parentPath,
        reservations,
        owners,
        nodeStates,
        branchOwnerPaths,
        ancestorOwnerStatus,
      );
      if (node.config.else) {
        collectStaticSubWorkflowReservations(
          node.config.else,
          parentPath,
          reservations,
          owners,
          nodeStates,
          branchOwnerPaths,
          ancestorOwnerStatus,
        );
      }
      return;
    case "loop":
      if (Array.isArray(node.config.steps)) {
        collectStaticSubWorkflowReservations(
          node.config.steps,
          parentPath,
          reservations,
          owners,
          nodeStates,
          branchOwnerPaths,
          ancestorOwnerStatus,
        );
      }
      return;
    case "map": {
      const wrapperNodes = collectStaticMapWrapperNodes(node);
      if (wrapperNodes) {
        collectStaticSubWorkflowReservations(
          wrapperNodes,
          parentPath,
          reservations,
          owners,
          nodeStates,
          branchOwnerPaths,
          ancestorOwnerStatus,
        );
      }
      return;
    }
    case "subWorkflow": {
      const ownerPath = subWorkflowOwnerPath(parentPath, node.id);
      owners.set(ownerPath, node.id);
      if (
        typeof node.config.workflow === "string" ||
        !Array.isArray(node.config.workflow.steps)
      ) return;
      const childIds = collectSubWorkflowNodeIds(node.config.workflow.steps, nodeStates);
      const recordedState = nodeStates[node.id];
      const recordedOwner = recordedState?._subWorkflowOwnerPath;
      const recordedSkipped = recordedState?.status === "skipped" &&
        (recordedOwner === undefined || isSubWorkflowDescendant(recordedOwner, ownerPath));
      const ownerStatus = recordedSkipped ? "skipped" : parentPath &&
          (ancestorOwnerStatus === "completed" || ancestorOwnerStatus === "skipped")
        ? ancestorOwnerStatus
        : recordedState?.status;
      if (ownerStatus === "skipped") childIds.clear();
      else if (ownerStatus === "completed") {
        narrowReservationsToSelectedBranches(
          node.config.workflow.steps,
          nodeStates,
          childIds,
          ownerPath,
          branchOwnerPaths,
        );
      }
      mergeSubWorkflowReservation(
        ownerPath,
        childIds,
        reservations,
      );
      collectStaticSubWorkflowReservations(
        node.config.workflow.steps,
        ownerPath,
        reservations,
        owners,
        nodeStates,
        branchOwnerPaths,
        ownerStatus,
      );
    }
  }
}

function collectStaticSubWorkflowReservations(
  nodes: WorkflowNode[],
  parentPath = "",
  reservations = new Map<string, Set<string>>(),
  owners = new Map<string, string>(),
  nodeStates: Readonly<Record<string, NodeState>> = {},
  branchOwnerPaths: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  ancestorOwnerStatus?: NodeState["status"],
): Map<string, Set<string>> {
  for (const node of nodes) {
    collectStaticSubWorkflowReservation(
      node,
      parentPath,
      reservations,
      owners,
      nodeStates,
      branchOwnerPaths,
      ancestorOwnerStatus,
    );
  }
  return reservations;
}

function collectNodeSharedChildIds(
  node: WorkflowNode,
  parentPath: string,
  scope: ExecutionScope,
  childIds: Set<string>,
): void {
  // A runtime skip can remove this node before it produces child state. Keep
  // it out of the static collision set and admit it separately below so the
  // skip decision is evaluated before any sibling reservation is compared.
  if (node.config.skip) return;

  switch (node.config.type) {
    case "subWorkflow": {
      const ownerPath = subWorkflowOwnerPath(parentPath, node.id);
      if (nodeHasUnknownSharedChildReservations(node)) break;
      const reservations = scope.subWorkflowNodeReservations.get(ownerPath);
      if (reservations) {
        for (const childId of reservations) childIds.add(childId);
      }
      break;
    }
    case "parallel":
      for (const child of node.config.nodes) {
        childIds.add(child.id);
        collectNodeSharedChildIds(child, parentPath, scope, childIds);
      }
      break;
    case "branch":
      for (const child of node.config.then) {
        childIds.add(child.id);
        collectNodeSharedChildIds(child, parentPath, scope, childIds);
      }
      for (const child of node.config.else ?? []) {
        childIds.add(child.id);
        collectNodeSharedChildIds(child, parentPath, scope, childIds);
      }
      break;
    case "loop":
      if (Array.isArray(node.config.steps)) {
        for (const child of node.config.steps) {
          childIds.add(child.id);
          collectNodeSharedChildIds(child, parentPath, scope, childIds);
        }
      }
      break;
    case "map": {
      const wrapperNodes = collectStaticMapWrapperNodes(node);
      if (!wrapperNodes) break;
      for (const wrapperNode of wrapperNodes) {
        childIds.add(wrapperNode.id);
        collectNodeSharedChildIds(wrapperNode, parentPath, scope, childIds);
      }
      break;
    }
  }
}

function nodeMayProduceSharedChildState(node: WorkflowNode): boolean {
  switch (node.config.type) {
    case "subWorkflow":
    case "parallel":
    case "branch":
    case "loop":
    case "map":
      return true;
    default:
      return false;
  }
}

function nodeHasUnknownSharedChildReservations(node: WorkflowNode): boolean {
  if (node.config.skip) return nodeMayProduceSharedChildState(node);

  switch (node.config.type) {
    case "subWorkflow":
      if (
        typeof node.config.workflow === "string" ||
        !Array.isArray(node.config.workflow.steps)
      ) return true;
      return node.config.workflow.steps.some(nodeHasUnknownSharedChildReservations);
    case "parallel":
      return node.config.nodes.some(nodeHasUnknownSharedChildReservations);
    case "branch":
      for (const child of node.config.then) {
        if (nodeHasUnknownSharedChildReservations(child)) return true;
      }
      for (const child of node.config.else ?? []) {
        if (nodeHasUnknownSharedChildReservations(child)) return true;
      }
      return false;
    case "loop":
      if (!Array.isArray(node.config.steps)) return true;
      return node.config.steps.some(nodeHasUnknownSharedChildReservations);
    case "map":
      return collectStaticMapWrapperNodes(node)?.some(
        nodeHasUnknownSharedChildReservations,
      ) ?? true;
    default:
      return false;
  }
}

function nodeHasConditionalSharedChildReservations(node: WorkflowNode): boolean {
  if (node.config.skip) return false;
  switch (node.config.type) {
    case "branch":
      return true;
    case "subWorkflow":
      if (
        typeof node.config.workflow === "string" ||
        !Array.isArray(node.config.workflow.steps)
      ) return false;
      return node.config.workflow.steps.some(nodeHasConditionalSharedChildReservations);
    case "parallel":
      return node.config.nodes.some(nodeHasConditionalSharedChildReservations);
    case "loop":
      return Array.isArray(node.config.steps) &&
        node.config.steps.some(nodeHasConditionalSharedChildReservations);
    case "map":
      return collectStaticMapWrapperNodes(node)?.some(
        nodeHasConditionalSharedChildReservations,
      ) ?? false;
    default:
      return false;
  }
}

function findConcurrentChildStateCollision(
  batch: string[],
  nodeMap: ReadonlyMap<string, WorkflowNode>,
  scope: ExecutionScope,
): { childId: string; firstNodeId: string; secondNodeId: string } | undefined {
  const reservedBy = new Map<string, string>();
  for (const nodeId of batch) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const reservations = new Set<string>();
    collectNodeSharedChildIds(node, scope.subWorkflowPath, scope, reservations);

    for (const childId of reservations) {
      const firstNodeId = reservedBy.get(childId);
      if (firstNodeId) {
        return { childId, firstNodeId, secondNodeId: node.id };
      }
      reservedBy.set(childId, node.id);
    }
  }
  return undefined;
}

function isSubWorkflowDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function reservationOwnerStatus(
  ownerPath: string,
  ownerNodeId: string | undefined,
  nodeStates: Readonly<Record<string, NodeState>>,
  scope: ExecutionScope,
): NodeState["status"] | undefined {
  for (const [candidatePath, candidateNodeId] of scope.subWorkflowReservationOwners) {
    if (candidatePath === ownerPath || !isSubWorkflowDescendant(ownerPath, candidatePath)) {
      continue;
    }
    const ancestorStatus = nodeStates[candidateNodeId]?.status;
    if (ancestorStatus === undefined || ancestorStatus === "pending") return ancestorStatus;
  }
  return ownerNodeId === undefined ? undefined : nodeStates[ownerNodeId]?.status;
}

function collectRecordedDescendantIds(
  parentId: string,
  nodeStates: Readonly<Record<string, NodeState>>,
  target: Set<string>,
): void {
  const prefix = `${parentId}/`;
  for (const nodeId of Object.keys(nodeStates)) {
    if (nodeId.startsWith(prefix)) target.add(nodeId);
  }
}

function collectCompletedCompositeChildIds(
  nodes: readonly WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
  target: Set<string>,
  context?: WorkflowContext,
): void {
  for (const node of nodes) {
    const status = nodeStates[node.id]?.status;
    if (status !== "completed") continue;

    if (node.config.type === "parallel") {
      collectExecutedCompositeNodeIds(node.config.nodes, nodeStates, target, context);
      continue;
    }
    if (node.config.type === "branch") {
      const output = nodeStates[node.id]?.output;
      const branch = typeof output === "object" && output !== null && "branch" in output
        ? (output as { branch?: unknown }).branch
        : undefined;
      const selected = branch === "then"
        ? node.config.then
        : branch === "else"
        ? (node.config.else ?? [])
        : [];
      collectExecutedCompositeNodeIds(selected, nodeStates, target, context);
      continue;
    }
    if (node.config.type === "map") {
      const output = nodeStates[node.id]?.output;
      if (Array.isArray(output)) {
        for (let index = 0; index < output.length; index++) {
          const wrapperId = `${node.id}_${index}`;
          if (nodeStates[wrapperId] === undefined) continue;
          target.add(wrapperId);
          const processor = node.config.processor;
          if (
            typeof processor === "object" && processor !== null && "steps" in processor &&
            typeof processor.steps === "function"
          ) {
            // Callback-defined workflow descendants cannot be recovered from
            // the definition after a restart. Their persisted, wrapper-prefixed
            // node-state ids are the execution evidence for legacy checkpoints
            // that predate explicit ownership metadata.
            collectRecordedDescendantIds(wrapperId, nodeStates, target);
          }
          if (
            typeof processor === "object" && processor !== null && "steps" in processor &&
            Array.isArray(processor.steps)
          ) {
            const namespaced = namespaceWorkflowDefinition(`${wrapperId}/`, processor);
            collectExecutedCompositeNodeIds(
              namespaced.steps as WorkflowNode[],
              nodeStates,
              target,
              context,
            );
          } else if (typeof processor === "object" && processor !== null && "config" in processor) {
            collectCompletedCompositeChildIds(
              [{
                id: wrapperId,
                config: rebaseCompositeDescendants(
                  processor.config,
                  processor.id,
                  wrapperId,
                ),
              }],
              nodeStates,
              target,
              context,
            );
          }
        }
      }
      continue;
    }
    if (node.config.type === "loop" && Array.isArray(node.config.steps)) {
      collectExecutedCompositeNodeIds(node.config.steps, nodeStates, target, context);
    } else if (node.config.type === "loop" && context) {
      for (const childId of nodeStates[node.id]?._completedCompositeChildIds ?? []) {
        target.add(childId);
      }
      const loopState = context[`${node.id}_loop_state`];
      const iterationNodeStates = typeof loopState === "object" && loopState !== null &&
          "iterationNodeStates" in loopState
        ? (loopState as { iterationNodeStates?: unknown }).iterationNodeStates
        : undefined;
      if (typeof iterationNodeStates === "object" && iterationNodeStates !== null) {
        for (const childId of Object.keys(iterationNodeStates)) target.add(childId);
      }
      const completedNodeIds = typeof loopState === "object" && loopState !== null &&
          "completedNodeIds" in loopState && Array.isArray(loopState.completedNodeIds)
        ? loopState.completedNodeIds
        : [];
      for (const childId of completedNodeIds) {
        if (typeof childId === "string") target.add(childId);
      }
    }
  }
}

function collectExecutedCompositeNodeIds(
  nodes: readonly WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
  target: Set<string>,
  context?: WorkflowContext,
): void {
  for (const node of nodes) {
    if (nodeStates[node.id] === undefined) continue;
    target.add(node.id);
    collectCompletedCompositeChildIds([node], nodeStates, target, context);
  }
}

function collectCompositeSubWorkflowOwnerPaths(
  nodes: readonly WorkflowNode[],
  parentPath: string,
  target: Set<string>,
): void {
  for (const node of nodes) {
    switch (node.config.type) {
      case "subWorkflow": {
        const ownerPath = subWorkflowOwnerPath(parentPath, node.id);
        target.add(ownerPath);
        if (
          typeof node.config.workflow !== "string" &&
          Array.isArray(node.config.workflow.steps)
        ) {
          collectCompositeSubWorkflowOwnerPaths(node.config.workflow.steps, ownerPath, target);
        }
        break;
      }
      case "parallel":
        collectCompositeSubWorkflowOwnerPaths(node.config.nodes, parentPath, target);
        break;
      case "branch":
        collectCompositeSubWorkflowOwnerPaths(node.config.then, parentPath, target);
        collectCompositeSubWorkflowOwnerPaths(node.config.else ?? [], parentPath, target);
        break;
      case "loop":
        if (Array.isArray(node.config.steps)) {
          collectCompositeSubWorkflowOwnerPaths(node.config.steps, parentPath, target);
        }
        break;
    }
  }
}

function hasActiveCallbackSubWorkflow(
  nodes: readonly WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
): boolean {
  for (const node of nodes) {
    switch (node.config.type) {
      case "subWorkflow":
        if (
          typeof node.config.workflow !== "string" &&
          typeof node.config.workflow.steps === "function" &&
          nodeStates[node.id]?.status === "running"
        ) return true;
        if (
          typeof node.config.workflow !== "string" &&
          Array.isArray(node.config.workflow.steps) &&
          hasActiveCallbackSubWorkflow(node.config.workflow.steps, nodeStates)
        ) return true;
        break;
      case "parallel":
        if (hasActiveCallbackSubWorkflow(node.config.nodes, nodeStates)) return true;
        break;
      case "branch":
        if (
          hasActiveCallbackSubWorkflow(node.config.then, nodeStates) ||
          hasActiveCallbackSubWorkflow(node.config.else ?? [], nodeStates)
        ) return true;
        break;
      case "loop":
        if (
          Array.isArray(node.config.steps) &&
          hasActiveCallbackSubWorkflow(node.config.steps, nodeStates)
        ) return true;
        break;
    }
  }
  return false;
}

function createCompositeNodeStateView(
  nodes: readonly WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
  parentPath: string,
  compositeNodeId: string,
  context: WorkflowContext,
  scope: ExecutionScope,
  mapNode?: WorkflowNode,
): Record<string, NodeState> {
  const declaredIds = collectWorkflowNodeIds([...nodes]);
  const loopOwnedStatePaths = new Map<string, string>();
  collectCompositeLoopStateEvidence(nodes, context, declaredIds, loopOwnedStatePaths);
  const allowedOwnerPaths = new Set<string>();
  collectCompositeSubWorkflowOwnerPaths(nodes, parentPath, allowedOwnerPaths);
  collectCompositeMapStateEvidence(
    nodes,
    nodeStates,
    parentPath,
    declaredIds,
    allowedOwnerPaths,
    false,
    context,
    loopOwnedStatePaths,
  );
  if (mapNode) {
    collectCompositeMapStateEvidence(
      [mapNode],
      nodeStates,
      parentPath,
      declaredIds,
      allowedOwnerPaths,
      true,
      context,
      loopOwnedStatePaths,
    );
  }
  const allowedOwnerPathList = [...allowedOwnerPaths];
  const claimedLegacyIds = new Set<string>(scope.completedCompositeChildIds);
  const activeCompositeChildIds = new Set(
    nodeStates[compositeNodeId]?._activeCompositeChildIds ?? [],
  );
  const preserveUnknownLegacyStates = hasActiveCallbackSubWorkflow(nodes, nodeStates);
  for (const [ownerPath, ownerNodeId] of scope.subWorkflowReservationOwners) {
    if (
      ownerPath === parentPath ||
      (parentPath.length > 0 && isSubWorkflowDescendant(parentPath, ownerPath))
    ) continue;
    const ownerStatus = reservationOwnerStatus(ownerPath, ownerNodeId, nodeStates, scope);
    if (ownerStatus !== "completed" && ownerStatus !== "skipped") continue;
    for (const nodeId of scope.subWorkflowNodeReservations.get(ownerPath) ?? []) {
      claimedLegacyIds.add(nodeId);
    }
  }
  const visible = Object.create(null) as Record<string, NodeState>;
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    const ownerPath = state._subWorkflowOwnerPath;
    if (ownerPath !== undefined) {
      const allowed = ownerPath === parentPath && declaredIds.has(nodeId) ||
        loopOwnedStatePaths.get(nodeId) === ownerPath ||
        allowedOwnerPathList.some((candidate) => isSubWorkflowDescendant(ownerPath, candidate));
      if (allowed) visible[nodeId] = state;
      continue;
    }
    if (
      !claimedLegacyIds.has(nodeId) &&
        (declaredIds.has(nodeId) || preserveUnknownLegacyStates) ||
      declaredIds.has(nodeId) && activeCompositeChildIds.has(nodeId)
    ) visible[nodeId] = state;
  }
  return visible;
}

function recordCompositeAttemptChildIds(
  nodeStates: Record<string, NodeState>,
  nodeId: string,
  childIds: readonly string[],
): void {
  const current = nodeStates[nodeId];
  if (!current) return;
  current._activeCompositeChildIds = [
    ...new Set([...(current._activeCompositeChildIds ?? []), ...childIds]),
  ];
}

function collectCompositeLoopStateEvidence(
  nodes: readonly WorkflowNode[],
  context: WorkflowContext,
  declaredIds: Set<string>,
  ownedStatePaths?: Map<string, string>,
): void {
  for (const node of nodes) {
    if (node.config.type === "loop") {
      const loopState = context[`${node.id}_loop_state`];
      if (
        typeof loopState === "object" && loopState !== null &&
        "iterationNodeStates" in loopState
      ) {
        const iterationNodeStates = (loopState as { iterationNodeStates?: unknown })
          .iterationNodeStates;
        if (typeof iterationNodeStates === "object" && iterationNodeStates !== null) {
          for (const [nodeId, state] of Object.entries(iterationNodeStates)) {
            declaredIds.add(nodeId);
            if (
              typeof state === "object" && state !== null && "_subWorkflowOwnerPath" in state &&
              typeof state._subWorkflowOwnerPath === "string"
            ) ownedStatePaths?.set(nodeId, state._subWorkflowOwnerPath);
          }
        }
      }
      if (
        typeof loopState === "object" && loopState !== null &&
        "completedNodeIds" in loopState && Array.isArray(loopState.completedNodeIds)
      ) {
        for (const nodeId of loopState.completedNodeIds) {
          if (typeof nodeId === "string") declaredIds.add(nodeId);
        }
      }
      if (Array.isArray(node.config.steps)) {
        collectCompositeLoopStateEvidence(node.config.steps, context, declaredIds, ownedStatePaths);
      }
    } else if (node.config.type === "parallel") {
      collectCompositeLoopStateEvidence(node.config.nodes, context, declaredIds, ownedStatePaths);
    } else if (node.config.type === "branch") {
      collectCompositeLoopStateEvidence(
        [...node.config.then, ...(node.config.else ?? [])],
        context,
        declaredIds,
        ownedStatePaths,
      );
    } else if (
      node.config.type === "subWorkflow" && typeof node.config.workflow !== "string" &&
      Array.isArray(node.config.workflow.steps)
    ) {
      collectCompositeLoopStateEvidence(
        node.config.workflow.steps,
        context,
        declaredIds,
        ownedStatePaths,
      );
    }
  }
}

/**
 * Rebuilds the node a map generates for one item, so a rebased processor's
 * descendant ids match the ids its children actually execute under.
 */
function rebaseMapProcessorNode(
  wrapperId: string,
  processor: WorkflowNode | WorkflowDefinition,
): WorkflowNode | undefined {
  if (typeof processor !== "object" || processor === null) return undefined;
  if ("steps" in processor) {
    return {
      id: wrapperId,
      config: {
        type: "subWorkflow",
        workflow: namespaceWorkflowDefinition(`${wrapperId}/`, processor),
      },
    };
  }
  if (!("config" in processor)) return undefined;
  return {
    id: wrapperId,
    config: rebaseCompositeDescendants(processor.config, processor.id, wrapperId),
  };
}

/** Return the generated map wrappers whose complete definitions are statically visible. */
function collectStaticMapWrapperNodes(node: WorkflowNode): WorkflowNode[] | undefined {
  if (node.config.type !== "map" || !Array.isArray(node.config.items)) return undefined;

  const wrappers: WorkflowNode[] = [];
  for (let index = 0; index < node.config.items.length; index++) {
    const wrapper = rebaseMapProcessorNode(`${node.id}_${index}`, node.config.processor);
    if (wrapper === undefined) return undefined;
    wrappers.push(wrapper);
  }
  return wrappers;
}

function collectCompositeMapStateEvidence(
  nodes: readonly WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
  parentPath: string,
  declaredIds: Set<string>,
  allowedOwnerPaths: Set<string>,
  includePending = false,
  context?: WorkflowContext,
  ownedStatePaths?: Map<string, string>,
): void {
  for (const node of nodes) {
    if (node.config.type === "map") {
      const output = nodeStates[node.id]?.output;
      const wrapperIds = new Set<string>();
      if (includePending) {
        for (const wrapper of collectStaticMapWrapperNodes(node) ?? []) {
          wrapperIds.add(wrapper.id);
        }
        if (nodeStates[node.id]?.status === "running") {
          const prefix = `${node.id}_`;
          for (const stateId of Object.keys(nodeStates)) {
            if (
              stateId.startsWith(prefix) && /^(?:0|[1-9][0-9]*)$/.test(stateId.slice(prefix.length))
            ) {
              wrapperIds.add(stateId);
            }
          }
        }
      }
      if (Array.isArray(output)) {
        for (let index = 0; index < output.length; index++) {
          const wrapperId = `${node.id}_${index}`;
          if (nodeStates[wrapperId] !== undefined) wrapperIds.add(wrapperId);
        }
      }
      const processor = node.config.processor;
      for (const wrapperId of wrapperIds) {
        declaredIds.add(wrapperId);
        allowedOwnerPaths.add(subWorkflowOwnerPath(parentPath, wrapperId));
        // A map processor executes under ids rebased onto the generated
        // wrapper, so its descendants are only reachable from the rebased
        // definition. Without them the enclosing composite withholds an
        // approved wait state and the map raises that approval again.
        const wrapper = rebaseMapProcessorNode(wrapperId, processor);
        if (wrapper === undefined) continue;
        if (context) {
          collectCompositeLoopStateEvidence([wrapper], context, declaredIds, ownedStatePaths);
        }
        for (const descendantId of collectWorkflowNodeIds([wrapper])) {
          declaredIds.add(descendantId);
        }
        if (
          typeof processor === "object" && processor !== null && "steps" in processor &&
          typeof processor.steps === "function"
        ) {
          collectRecordedDescendantIds(wrapperId, nodeStates, declaredIds);
        }
        collectCompositeSubWorkflowOwnerPaths([wrapper], parentPath, allowedOwnerPaths);
        collectCompositeMapStateEvidence(
          [wrapper],
          nodeStates,
          parentPath,
          declaredIds,
          allowedOwnerPaths,
          includePending,
          context,
          ownedStatePaths,
        );
      }
      continue;
    }
    if (node.config.type === "parallel") {
      collectCompositeMapStateEvidence(
        node.config.nodes,
        nodeStates,
        parentPath,
        declaredIds,
        allowedOwnerPaths,
        includePending,
        context,
        ownedStatePaths,
      );
    } else if (node.config.type === "branch") {
      collectCompositeMapStateEvidence(
        [...node.config.then, ...(node.config.else ?? [])],
        nodeStates,
        parentPath,
        declaredIds,
        allowedOwnerPaths,
        includePending,
        context,
        ownedStatePaths,
      );
    } else if (node.config.type === "loop" && Array.isArray(node.config.steps)) {
      collectCompositeMapStateEvidence(
        node.config.steps,
        nodeStates,
        parentPath,
        declaredIds,
        allowedOwnerPaths,
        includePending,
        context,
        ownedStatePaths,
      );
    } else if (
      node.config.type === "subWorkflow" && typeof node.config.workflow !== "string" &&
      Array.isArray(node.config.workflow.steps)
    ) {
      const ownerPath = subWorkflowOwnerPath(parentPath, node.id);
      collectCompositeMapStateEvidence(
        node.config.workflow.steps,
        nodeStates,
        ownerPath,
        declaredIds,
        allowedOwnerPaths,
        includePending,
        context,
        ownedStatePaths,
      );
    }
  }
}

function collectSubWorkflowNodeIds(
  nodes: WorkflowNode[],
  nodeStates: Readonly<Record<string, NodeState>>,
): Set<string> {
  const ids = collectWorkflowNodeIds(nodes);
  collectCompositeMapStateEvidence(nodes, nodeStates, "", ids, new Set(), true);
  return ids;
}

function collectPreviouslyProducedSubWorkflowNodeIds(
  ownerPath: string,
  nodeStates: Record<string, NodeState>,
  scope: ExecutionScope,
): Set<string> {
  const producedNodeIds = new Set<string>();
  const currentOwnerIsActive = scope.resumedSubWorkflowOwnerPaths.has(ownerPath);
  const currentOwnerNodeId = scope.subWorkflowReservationOwners.get(ownerPath);
  const recordedReachedNodeIds = currentOwnerNodeId === undefined
    ? undefined
    : nodeStates[currentOwnerNodeId]?._activeCompositeChildIds;
  // Checkpoints written before reach evidence existed can only retain the
  // legacy all-reservations behavior; new waits persist the precise subset.
  const currentOwnerReachedNodeIds = new Set(
    currentOwnerIsActive
      ? recordedReachedNodeIds ?? scope.subWorkflowNodeReservations.get(ownerPath) ?? []
      : [],
  );
  const isReachedByCurrentOwner = (nodeId: string, state: NodeState): boolean =>
    currentOwnerIsActive && currentOwnerReachedNodeIds.has(nodeId) &&
    state._subWorkflowOwnerPath === undefined;
  for (const nodeId of scope.completedCompositeChildIds) {
    const state = nodeStates[nodeId];
    if (state && isReachedByCurrentOwner(nodeId, state)) continue;
    producedNodeIds.add(nodeId);
  }
  for (const [owner, ids] of scope.subWorkflowNodeIds) {
    if (isSubWorkflowDescendant(owner, ownerPath)) continue;
    for (const id of ids) producedNodeIds.add(id);
  }
  for (const [owner, ownerNodeId] of scope.subWorkflowReservationOwners) {
    if (
      scope.subWorkflowNodeReservations.has(owner) ||
      isSubWorkflowDescendant(owner, ownerPath) ||
      isSubWorkflowDescendant(ownerPath, owner)
    ) continue;
    const ownerStatus = reservationOwnerStatus(owner, ownerNodeId, nodeStates, scope);
    if (ownerStatus === undefined || ownerStatus === "pending") continue;
    // A callback-defined sibling from a pre-ownership checkpoint exposes no
    // static child reservation. Once that sibling has started, any ownerless
    // legacy child could be its output; treating it as previously produced is
    // conservative and prevents a later sibling from bypassing its own wait.
    for (const [nodeId, state] of Object.entries(nodeStates)) {
      if (isReachedByCurrentOwner(nodeId, state)) continue;
      if (state._subWorkflowOwnerPath === undefined) producedNodeIds.add(nodeId);
    }
  }
  for (const [owner, ids] of scope.subWorkflowNodeReservations) {
    // Ancestor reservations recursively include this owner's ids, so only
    // true sibling reservations should block legacy state seeding.
    if (
      isSubWorkflowDescendant(owner, ownerPath) ||
      isSubWorkflowDescendant(ownerPath, owner)
    ) continue;
    const ownerNodeId = scope.subWorkflowReservationOwners.get(owner);
    const ownerStatus = reservationOwnerStatus(owner, ownerNodeId, nodeStates, scope);
    if (ownerStatus === undefined || ownerStatus === "pending") continue;
    for (const id of ids) {
      const state = nodeStates[id];
      if (state && isReachedByCurrentOwner(id, state)) continue;
      producedNodeIds.add(id);
    }
  }
  return producedNodeIds;
}

function shouldSeedSubWorkflowState(
  nodeId: string,
  state: NodeState,
  ownerPath: string,
  reservations: ReadonlySet<string>,
  previouslyProducedNodeIds: ReadonlySet<string>,
): boolean {
  if (state._subWorkflowOwnerPath) {
    return isSubWorkflowDescendant(state._subWorkflowOwnerPath, ownerPath);
  }
  // Keep legacy static child states resumable when ownership metadata is
  // absent, but never admit one claimed by another sibling reservation.
  return reservations.has(nodeId) && !previouslyProducedNodeIds.has(nodeId);
}

function createSeededSubWorkflowNodeStates(
  ownerPath: string,
  childNodeIds: Set<string>,
  nodeStates: Record<string, NodeState>,
  scope: ExecutionScope,
): { seededNodeStates: Record<string, NodeState>; ownedNodeIds: Set<string> } {
  const ownedNodeIds = scope.subWorkflowNodeIds.get(ownerPath) ?? new Set<string>();
  const reservations = scope.subWorkflowNodeReservations.get(ownerPath) ?? new Set<string>();
  for (const childId of childNodeIds) reservations.add(childId);
  scope.subWorkflowNodeReservations.set(ownerPath, reservations);

  const previouslyProducedNodeIds = collectPreviouslyProducedSubWorkflowNodeIds(
    ownerPath,
    nodeStates,
    scope,
  );
  const seededNodeStates = Object.create(null) as Record<string, NodeState>;
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (scope.declaredNodeIds.has(nodeId)) continue;
    if (
      shouldSeedSubWorkflowState(
        nodeId,
        state,
        ownerPath,
        reservations,
        previouslyProducedNodeIds,
      )
    ) seededNodeStates[nodeId] = state;
  }
  return { seededNodeStates, ownedNodeIds };
}

function ownSubWorkflowResultNodeStates(
  resultNodeStates: Record<string, NodeState>,
  ownerPath: string,
  declaredNodeIds: ReadonlySet<string>,
  ownedNodeIds: ReadonlySet<string>,
): { ownedResultNodeStates: Record<string, NodeState>; producedNodeIds: Set<string> } {
  const ownedResultNodeStates = Object.create(null) as Record<string, NodeState>;
  const producedNodeIds = new Set(ownedNodeIds);
  for (const [childId, childState] of Object.entries(resultNodeStates)) {
    const state = childState._subWorkflowOwnerPath
      ? childState
      : { ...childState, _subWorkflowOwnerPath: ownerPath };
    ownedResultNodeStates[childId] = state;
    if (!declaredNodeIds.has(childId)) producedNodeIds.add(childId);
  }
  return { ownedResultNodeStates, producedNodeIds };
}

function getUnfinishedNodeDetails(
  nodes: WorkflowNode[],
  nodeStates: Record<string, NodeState>,
): Array<{ nodeId: string; status: NodeState["status"] }> {
  return nodes.flatMap((node) => {
    const status = nodeStates[node.id]?.status ?? "pending";
    return status === "completed" || status === "skipped" ? [] : [{ nodeId: node.id, status }];
  });
}

export class DAGExecutor {
  private config: DAGExecutorInternalConfig;

  constructor(config: DAGExecutorConfig) {
    this.config = {
      maxConcurrency: 10,
      debug: false,
      ...config,
    };
  }

  async execute(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGExecutionResult> {
    const subWorkflowNodeIds = new Map<string, Set<string>>();
    for (const [nodeId, state] of Object.entries(run.nodeStates)) {
      const ownerPath = state._subWorkflowOwnerPath;
      if (!ownerPath) continue;
      const ownedNodeIds = subWorkflowNodeIds.get(ownerPath) ?? new Set<string>();
      ownedNodeIds.add(nodeId);
      subWorkflowNodeIds.set(ownerPath, ownedNodeIds);
    }
    const scope: ExecutionScope = {
      rootRunId: run.id,
      executionRunId: run.id,
      // Read the reason execution stopped once, here, from the only run record
      // that carries it. Every child graph below runs against a synthetic run
      // whose status is always "running" and would otherwise read a crash.
      resumingWait: run.status === "waiting",
      declaredNodeIds: new Set(),
      subWorkflowNodeIds,
      completedCompositeChildIds: new Set(),
      subWorkflowNodeReservations: new Map(),
      subWorkflowReservationOwners: new Map(),
      resumedSubWorkflowOwnerPaths: new Set(),
      subWorkflowPath: "",
      rootKeyspace: true,
      ownership,
    };
    const { contextPatch: _contextPatch, ...result } = await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.executeUnwrapped(nodes, run, scope, startFromNode, abortSignal),
    );
    return result;
  }

  private async executeUnwrapped(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    scope: ExecutionScope,
    startFromNode?: string,
    abortSignal?: AbortSignal,
  ): Promise<DAGInternalExecutionResult> {
    abortSignal?.throwIfAborted();
    const context = cloneExecutionState(run.context, "Workflow context");
    const nodeStates = cloneExecutionState(run.nodeStates, "Workflow node states");
    let publishedNodeStates = cloneExecutionState(run.nodeStates, "Workflow node states");
    let contextPatch = createSetContextPatch();

    const { adjList, inDegree, nodeMap } = buildGraph(nodes);
    const graphNodeIds = new Set(nodeMap.keys());
    scope = {
      ...scope,
      declaredNodeIds: new Set([...scope.declaredNodeIds, ...graphNodeIds]),
    };

    // Reserve child ids for every graph as it starts, not once for the root
    // definition. A sub-workflow's `steps` callback, a map processor's
    // per-item namespaces, and a loop's generated steps all produce their
    // graph only at execution time, so a collector that ran once over the root
    // nodes would leave those graphs' batches unprotected.
    const branchOwnerPaths = new Map<string, Set<string>>();
    collectBranchOwnerPaths(nodes, scope.subWorkflowPath, branchOwnerPaths);
    collectStaticSubWorkflowReservations(
      nodes,
      scope.subWorkflowPath,
      scope.subWorkflowNodeReservations,
      scope.subWorkflowReservationOwners,
      nodeStates,
      branchOwnerPaths,
    );
    collectCompletedCompositeChildIds(
      nodes,
      nodeStates,
      scope.completedCompositeChildIds,
      context,
    );

    updateInDegreesForCompletedNodes(nodeStates, adjList, inDegree);

    if (hasCycle(nodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        contextPatch,
        error: "Workflow DAG contains cycles",
      };
    }

    // Only the top-level run has a row in the backend to write. Composites
    // execute their children against synthetic runs (`${node.id}_parallel`,
    // `_branch`, `_iter_N`) whose node states are a different keyspace: a loop
    // iteration's run carries only that iteration's children. Persisting one
    // of those under the real run id would replace the run's whole node-state
    // map with an iteration-local fragment, stranding every completed
    // top-level node as pending and re-running the workflow from the start --
    // the duplicate side effect this recovery path exists to prevent.
    // Child recoveries are persisted by the parent when it returns.
    const isDurableRun = run.id === scope.rootRunId;
    // Nodes queued for crash recovery that have not been admitted to a batch
    // yet. Being queued spends nothing: an earlier node in the queue can park
    // on a wait and end the pass before these ever start, and a node that
    // never started must keep its one recovery for the next pass. The budget
    // is charged at admission instead, below.
    const recoveryQueued = new Set<string>();

    let ready = startFromNode ? [startFromNode] : getReadyNodes(inDegree, nodeStates);
    const resumableCompositeIds = new Set<string>();
    if (!startFromNode) {
      // A node recorded as running means different things depending on why the
      // run stopped, and the two must not be confused.
      //
      // A waiting run parked deliberately: the running node is a composite whose
      // child is on a human decision. Re-enter it so the child resumes.
      //
      // Any other run reaching here is recovering from a worker that died
      // mid-node. Nothing will ever write that node a terminal state, and
      // getReadyNodes does not consider it ready, so leaving it be strands the
      // run. Re-run it. That matches what already happens when a worker dies
      // before writing any state at all -- the node looks untouched and runs
      // again -- except that the recorded attempt now bounds the retries.
      //
      // This reads the reason off the scope, never off `run`: a child graph's
      // run is synthetic and permanently "running", so inferring it here would
      // charge every nested composite re-entry to the crash budget on an
      // ordinary approval.
      const { resumingWait } = scope;
      const exhausted: Array<{ nodeId: string; attempts: number; maxAttempts: number }> = [];
      const resumableComposites: string[] = [];
      for (const [nodeId, degree] of inDegree) {
        if (degree !== 0 || ready.includes(nodeId)) continue;
        const state = nodeStates[nodeId];
        if (state?.status !== "running") continue;
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        // A composite recorded running on a wait resume encloses the decision.
        // Re-enter it so the child resumes; nothing crashed, so it spends no
        // recovery budget.
        if (resumingWait && RESUMABLE_COMPOSITE_TYPES.has(node.config.type)) {
          resumableCompositeIds.add(nodeId);
          if (node.config.type === "subWorkflow") {
            scope.resumedSubWorkflowOwnerPaths.add(
              subWorkflowOwnerPath(scope.subWorkflowPath, node.id),
            );
          }
          resumableComposites.push(nodeId);
          continue;
        }
        // A wait recorded as running is parked on its decision, never a dead
        // worker: nothing executes while it waits, so there is nothing to
        // recover. Re-running it would re-raise an approval that already exists.
        // This also matters inside a loop or branch child graph, whose synthetic
        // run is always "running" even while its wait is parked.
        if (node.config.type === "wait") continue;

        // Anything else recorded running falls through to recovery even on a
        // wait resume. Parked and interrupted are not exclusive: a worker can
        // die with a step in flight, leave a sibling wait parked, and the run
        // then reaches "waiting" with that step still marked running. Treating
        // the whole resume as "nothing to recover" strands it -- and because
        // nothing is left ready, the graph reports completion and the workflow
        // finishes having silently skipped it.

        // The step executor restarts its own retry loop at 1 and overwrites the
        // recorded attempt, so it cannot bound anything across worker deaths.
        // Count them here instead, or repeated crashes re-run the node forever
        // and duplicate whatever side effect it performs.
        //
        // An interrupted attempt never finished, so it does not consume the
        // node's retry budget outright -- a default node still gets recovered
        // once. What it does consume is one recovery, charged when the node is
        // admitted to a batch: the raised count is written back before the node
        // executes, and nothing overwrites it if the worker dies again, so the
        // next resume sees a higher number.
        const maxAttempts = node.config.retry?.maxAttempts ?? 1;
        const attempts = state.attempt ?? 0;
        if (attempts > maxAttempts) {
          exhausted.push({ nodeId, attempts, maxAttempts });
          continue;
        }
        recoveryQueued.add(nodeId);
        ready.push(nodeId);
      }
      // A pending sibling can legally reuse child IDs after this composite
      // finishes, but it must not overwrite the approval the active composite
      // is resuming. Re-enter active composites before untouched ready nodes;
      // normal batch collision checks still compare them when concurrency
      // admits more than one at once.
      ready = [...resumableComposites, ...ready];

      if (exhausted.length > 0) {
        const first = exhausted[0]!;
        for (const { nodeId, attempts, maxAttempts } of exhausted) {
          nodeStates[nodeId] = {
            ...nodeStates[nodeId]!,
            status: "failed",
            error:
              `Interrupted after ${attempts} of ${maxAttempts} attempt(s); retry budget exhausted`,
            completedAt: new Date(),
          };
        }
        return {
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          error: `Node "${first.nodeId}" was interrupted after ${first.attempts} of ` +
            `${first.maxAttempts} attempt(s); retry budget exhausted`,
        };
      }
    }

    while (ready.length > 0) {
      abortSignal?.throwIfAborted();
      const candidateBatch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      // Runtime-defined composite children cannot be reserved without invoking
      // project callbacks or selecting branches before their dependency
      // context exists. Statically visible child ids were proven distinct
      // above; unresolved producers are serialized against other composite
      // producers in the same batch.
      const unresolvedNodeIds: string[] = [];
      const resolvedProducerIds: string[] = [];
      for (const nodeId of candidateBatch) {
        const node = nodeMap.get(nodeId);
        if (node === undefined || !nodeMayProduceSharedChildState(node)) continue;
        if (nodeHasUnknownSharedChildReservations(node)) unresolvedNodeIds.push(nodeId);
        else resolvedProducerIds.push(nodeId);
      }
      let batch = candidateBatch;
      const resumedProducerIds = candidateBatch.filter((nodeId) =>
        resumableCompositeIds.has(nodeId) &&
        nodeMayProduceSharedChildState(nodeMap.get(nodeId)!)
      );
      if (
        resumedProducerIds.length > 0 &&
        resumedProducerIds.length < unresolvedNodeIds.length + resolvedProducerIds.length
      ) {
        // A producer that already owns a parked decision must consume it before
        // a newly ready producer can overwrite the shared child-state key.
        const resumed = new Set(resumedProducerIds);
        const deferred = new Set(
          [...unresolvedNodeIds, ...resolvedProducerIds].filter((nodeId) => !resumed.has(nodeId)),
        );
        batch = candidateBatch.filter((nodeId) => !deferred.has(nodeId));
        ready = [...candidateBatch.filter((nodeId) => deferred.has(nodeId)), ...ready];
      } else if (
        unresolvedNodeIds.length > 0 && unresolvedNodeIds.length + resolvedProducerIds.length > 1
      ) {
        // Admit the first unresolved producer before any known producer. Its
        // selected child IDs then become historical state that the later
        // producer's ownership checks cannot mistake for its own children.
        const deferred = new Set([...unresolvedNodeIds.slice(1), ...resolvedProducerIds]);
        batch = candidateBatch.filter((nodeId) => !deferred.has(nodeId));
        ready = [...candidateBatch.filter((nodeId) => deferred.has(nodeId)), ...ready];
      }

      // Child states are persisted in the shared root node-state map. Compare
      // only the nodes actually admitted together: an unresolved producer was
      // serialized above precisely because its final reservation set cannot be
      // known until it runs.
      let childCollision = findConcurrentChildStateCollision(batch, nodeMap, scope);
      if (childCollision) {
        const firstNode = nodeMap.get(childCollision.firstNodeId);
        const secondNode = nodeMap.get(childCollision.secondNodeId);
        const conditionalNodeId = firstNode && nodeHasConditionalSharedChildReservations(firstNode)
          ? firstNode.id
          : secondNode && nodeHasConditionalSharedChildReservations(secondNode)
          ? secondNode.id
          : undefined;
        if (conditionalNodeId !== undefined) {
          const deferredProducerIds = batch.filter((nodeId) => {
            const candidate = nodeMap.get(nodeId);
            return nodeId !== conditionalNodeId && candidate !== undefined &&
              nodeMayProduceSharedChildState(candidate);
          });
          const deferred = new Set(deferredProducerIds);
          batch = batch.filter((nodeId) => !deferred.has(nodeId));
          ready = [...deferredProducerIds, ...ready];
          childCollision = findConcurrentChildStateCollision(batch, nodeMap, scope);
        }
      }
      if (childCollision) {
        const detail = `Concurrent nodes "${childCollision.firstNodeId}" and ` +
          `"${childCollision.secondNodeId}" both declare child id ` +
          `"${childCollision.childId}"`;
        return {
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          error: detail,
          errorCause: INVALID_ARGUMENT.create({ detail }),
        };
      }

      const batchStartedAt = new Date();
      const recoveredInBatch: string[] = [];
      for (const nodeId of batch) {
        const existing = nodeStates[nodeId];
        // A node already recorded running keeps its attempt: it is being
        // re-entered, not restarted (a composite resuming a parked wait). A
        // node admitted off the recovery queue is the exception -- an
        // interrupted attempt is being replaced, and raising the count here is
        // what bounds repeated worker deaths. A node only reaches here once it
        // is actually starting, so the recovery it spends is one it gets to use.
        const isRecovery = recoveryQueued.delete(nodeId);
        if (isRecovery) recoveredInBatch.push(nodeId);
        const runningState: NodeState = {
          ...existing,
          nodeId,
          status: "running",
          attempt: existing?.status === "running" && !isRecovery
            ? existing.attempt
            : (existing?.attempt ?? 0) + 1,
          startedAt: existing?.status === "running" && existing.startedAt
            ? existing.startedAt
            : batchStartedAt,
        };
        delete runningState.completedAt;
        delete runningState.error;
        delete runningState.output;
        nodeStates[nodeId] = runningState;
      }
      if (isDurableRun) {
        // Sole durable admission commit, recovery charges included. A refused
        // fence throws before anything executes, raised attempt unpersisted.
        publishedNodeStates = await this.publishNodeStates(
          scope,
          nodeStates,
          publishedNodeStates,
          context,
          contextPatch,
          batch,
        );
        abortSignal?.throwIfAborted();
      } else if (scope.rootKeyspace && recoveredInBatch.length > 0) {
        // A recovered child of a shared-keyspace composite: its raised attempt
        // must be durable before it executes, or repeated worker deaths re-run
        // it past its budget. The patch carries only the admitted recoveries,
        // merged by key into the root map -- never replacing it.
        const patchSet: Record<string, NodeState> = {};
        for (const nodeId of recoveredInBatch) {
          patchSet[nodeId] = structuredClone(nodeStates[nodeId]!);
        }
        const persisted = await this.config.onChildRecoveryAdmitted?.({
          runId: scope.rootRunId,
          nodeStatePatch: { set: patchSet, delete: [] },
          ownership: scope.ownership,
        });
        if (persisted === false) {
          throw ORCHESTRATION_ERROR.create({
            detail: "Workflow execution ownership changed before child recovery persistence",
            context: { ownershipLost: true },
          });
        }
        abortSignal?.throwIfAborted();
      }

      // Clone the batch baseline and each node's view deeply. Workflow context
      // is durable, structured-cloneable state, so this matches checkpoint and
      // resume semantics while preventing nested mutation from crossing an
      // in-flight node boundary.
      const baseContext = cloneExecutionState(context, "Workflow context");
      const baseNodeStates = cloneExecutionState(nodeStates, "Workflow node states");
      const contextSnapshots = batch.map(() =>
        cloneExecutionState(baseContext, "Workflow context")
      );
      const nodeStateSnapshots = batch.map(() =>
        cloneExecutionState(baseNodeStates, "Workflow node states")
      );

      const results = await Promise.allSettled(
        batch.map((nodeId, i) =>
          this.executeNode(
            nodeMap.get(nodeId)!,
            contextSnapshots[i]!,
            nodeStateSnapshots[i]!,
            scope,
            abortSignal,
          )
        ),
      );
      // Wait for the full in-flight batch to settle before propagating abort so
      // the caller keeps its lock until cooperative cleanup has completed.
      abortSignal?.throwIfAborted();

      // Record the state of EVERY node in the batch before deciding the batch's
      // outcome. The whole batch already ran (Promise.allSettled), so returning
      // on the first failure would drop the persisted state of later nodes that
      // actually succeeded, and those would re-execute on resume. We capture
      // the earliest waiting/failed node (preserving index-order precedence) and
      // return only after all states are recorded.
      let outcome:
        | {
          kind: "waiting" | "failed";
          nodeId: string;
          waitConfig?: WaitNodeConfig;
          error?: string;
          errorCause?: NonNullable<DAGExecutionResult["errorCause"]>;
        }
        | undefined;
      // Every node the settled batch parked, in index order. Dependency-free
      // waits run in one batch and all suspend; reporting only the first
      // would persist a durable record for it alone, leaving the others
      // parked with nothing able to wake them.
      const waitingNodes: Array<{ nodeId: string; waitConfig?: WaitNodeConfig }> = [];
      const checkpointNodes: string[] = [];

      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status !== "fulfilled") {
          // Ownership loss inside a composite is not a node failure: this
          // worker no longer owns the run row and must stop writing, not
          // record a failed state another worker's recovery would then read.
          if (isOwnershipLossError(result.reason)) throw result.reason;
          const error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

          nodeStates[nodeId] = {
            nodeId,
            status: "failed",
            error,
            attempt: baseNodeStates[nodeId]!.attempt,
            startedAt: baseNodeStates[nodeId]!.startedAt,
            completedAt: new Date(),
          };

          if (!outcome) outcome = { kind: "failed", nodeId, error };
          continue;
        }

        const nodeResult = result.value;

        // Convert mutable callback effects into explicit top-level patches.
        // Patches are applied in node declaration order, preserving the existing
        // deterministic policy that a later sibling wins a same-key write.
        const nodeStateSnapshot = nodeStateSnapshots[i]!;
        applyRecordPatch(nodeStates, createRecordPatch(baseNodeStates, nodeStateSnapshot));
        const contextSnapshot = contextSnapshots[i]!;
        const nodeContextPatch = nodeResult.state.status === "failed"
          ? createSetContextPatch()
          : mergeContextPatches(
            createContextPatch(baseContext, contextSnapshot),
            nodeResult.contextPatch,
          );
        const isolatedContextPatch = cloneExecutionState(
          nodeContextPatch,
          "Workflow context changes",
        );
        applyContextPatch(context, isolatedContextPatch);
        contextPatch = mergeContextPatches(contextPatch, isolatedContextPatch);

        nodeStates[nodeId] = cloneExecutionState(
          {
            ...nodeResult.state,
            attempt: Math.max(nodeResult.state.attempt, baseNodeStates[nodeId]!.attempt),
            startedAt: baseNodeStates[nodeId]!.startedAt,
          },
          "Workflow node state",
        );
        collectCompletedCompositeChildIds(
          [nodeMap.get(nodeId)!],
          nodeStates,
          scope.completedCompositeChildIds,
          context,
        );

        if (nodeResult.waiting) {
          // A composite reports the child that actually suspended. Falling back
          // to this node covers a top-level wait, which is its own waiting node.
          const nestedWaitingNodes = nodeResult.waitingNodes && nodeResult.waitingNodes.length > 0
            ? nodeResult.waitingNodes
            : [{
              nodeId: nodeResult.waitingNode ?? nodeId,
              waitConfig: nodeResult.waitingConfig,
            }];
          waitingNodes.push(...nestedWaitingNodes);
          if (!outcome) {
            outcome = {
              kind: "waiting",
              nodeId: nestedWaitingNodes[0]!.nodeId,
              waitConfig: nestedWaitingNodes[0]!.waitConfig,
            };
          }
          continue;
        }

        const nodeConfig = nodeMap.get(nodeId);
        if (nodeResult.state.status === "completed" && nodeConfig && shouldCheckpoint(nodeConfig)) {
          checkpointNodes.push(nodeId);
        }

        if (nodeResult.state.status === "failed") {
          if (!outcome) {
            outcome = {
              kind: "failed",
              nodeId,
              error: nodeResult.state.error ?? "Unknown error",
              errorCause: nodeResult.errorCause,
            };
          }
          continue;
        }

        if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
          for (const dependent of adjList.get(nodeId) ?? []) {
            inDegree.set(dependent, inDegree.get(dependent)! - 1);
          }
        }
      }

      if (isDurableRun) {
        // A node that completed or was skipped is no longer current. One still
        // recorded running is parked (a wait, or a composite enclosing one) and
        // stays current so a paused run names what it is parked on. A failed
        // node stays current too: the run is about to fail on it, and the
        // terminal record must still name where it stopped.
        const stillCurrent = batch.filter((nodeId) => {
          const status = nodeStates[nodeId]?.status;
          return status === "running" || status === "failed";
        });
        publishedNodeStates = await this.publishNodeStates(
          scope,
          nodeStates,
          publishedNodeStates,
          context,
          contextPatch,
          stillCurrent,
        );
        abortSignal?.throwIfAborted();
      }
      for (const nodeId of checkpointNodes) {
        await this.checkpoint(run.id, nodeId, context, nodeStates, scope.ownership);
      }

      if (outcome?.kind === "waiting") {
        return {
          completed: false,
          waiting: true,
          waitingNode: outcome.nodeId,
          waitingConfig: outcome.waitConfig,
          waitingNodes,
          context,
          nodeStates,
          contextPatch,
        };
      }

      if (outcome?.kind === "failed") {
        return {
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          error: `Node "${outcome.nodeId}" failed: ${outcome.error}`,
          errorCause: outcome.errorCause,
        };
      }

      // Merge freshly-unblocked nodes with any overflow nodes still queued in
      // `ready` (the slice beyond maxConcurrency that has not run yet). Those
      // overflow nodes have inDegree 0 and no recorded state, so
      // getReadyNodes() would return them again. De-duplicate to avoid
      // scheduling (and double-decrementing dependents for) a node that is
      // already queued.
      const queued = new Set(ready);
      for (const nodeId of getReadyNodes(inDegree, nodeStates)) {
        if (queued.has(nodeId)) continue;
        queued.add(nodeId);
        ready.push(nodeId);
      }
    }

    const unfinished = getUnfinishedNodeDetails(nodes, nodeStates);
    if (unfinished.length > 0) {
      const graph = run.id === scope.rootRunId
        ? "the root graph"
        : `child graph ${JSON.stringify(run.id)}`;
      const details = unfinished.slice(0, MAX_STALLED_GRAPH_NODE_DETAILS)
        .map(({ nodeId, status }) => `${JSON.stringify(nodeId)} (${status})`)
        .join(", ");
      const omitted = unfinished.length - MAX_STALLED_GRAPH_NODE_DETAILS;
      // Nothing was schedulable, and every unfinished node is either a wait
      // recorded running or blocked behind one. From here that is
      // indistinguishable from a run legitimately parked on a decision that has
      // not arrived yet, so name the wait and let the caller check the durable
      // record before treating this as terminal.
      const onlyParkedWaitsAndDependents = unfinished.every(({ nodeId, status }) =>
        status === "pending" ||
        (status === "running" && nodeMap.get(nodeId)?.config.type === "wait")
      );
      const stalledWaitNodes: Array<{ nodeId: string; waitConfig: WaitNodeConfig }> = [];
      if (onlyParkedWaitsAndDependents) {
        for (const { nodeId, status } of unfinished) {
          const config = nodeMap.get(nodeId)?.config;
          if (status === "running" && config?.type === "wait") {
            stalledWaitNodes.push({ nodeId, waitConfig: config });
          }
        }
      }
      const stalledWaitNode = stalledWaitNodes[0]?.nodeId;
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        contextPatch,
        ...(stalledWaitNode === undefined ? {} : { stalledWaitNode, stalledWaitNodes }),
        error: `Workflow run ${JSON.stringify(scope.rootRunId)} stalled in ${graph}; ` +
          `unfinished nodes: ${details}${omitted > 0 ? `, and ${omitted} more` : ""}`,
      };
    }

    return {
      completed: true,
      waiting: false,
      context,
      nodeStates,
      contextPatch,
    };
  }

  private async publishNodeStates(
    scope: ExecutionScope,
    nodeStates: Record<string, NodeState>,
    previousNodeStates: Record<string, NodeState>,
    context: WorkflowContext,
    contextPatch: ContextPatch,
    currentNodes: string[],
  ): Promise<Record<string, NodeState>> {
    const nodeStatePatch = createRecordPatch(previousNodeStates, nodeStates);
    const published = await this.config.onNodeStatesChanged?.({
      runId: scope.rootRunId,
      nodeStates: structuredClone(nodeStates),
      nodeStatePatch: cloneExecutionState(nodeStatePatch, "Workflow node-state changes"),
      currentNodes: [...currentNodes],
      context: structuredClone(context),
      contextPatch: cloneExecutionState(contextPatch, "Workflow context changes"),
      ownership: scope.ownership,
    });
    if (published === false) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow execution ownership changed before node-state persistence",
        context: { ownershipLost: true },
      });
    }
    return cloneExecutionState(nodeStates, "Workflow node states");
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const nodeId = node.id;

    const existingState = nodeStates[nodeId];
    if (existingState?.status === "completed") {
      // Replayed from a checkpoint: no work happens in this execution, so no span.
      return { state: existingState, contextPatch: createSetContextPatch(), waiting: false };
    }

    return await withSpan(
      `workflow.node ${nodeId}`,
      async () => {
        const result = await this.dispatchNode(
          node,
          context,
          nodeStates,
          scope,
          abortSignal,
        );
        // A failing node returns a failed state rather than throwing, so the span's own
        // catch never runs. Without this the span stays UNSET and a failed run is
        // indistinguishable from a successful one in any trace backend.
        setActiveSpanAttributes({ "workflow.node.status": result.state.status });
        if (result.state.status === "failed") {
          // The failure must be visible to errored-span queries, but the node's error
          // text is user-supplied and can carry customer data -- the same reason retry
          // events carry a classification rather than a message. Identify the node, not
          // the failure text; the detail stays in the run record and the logs.
          setActiveSpanErrorStatus(new Error(`Node "${nodeId}" failed`));
        }
        return result;
      },
      {
        "workflow.run_id": scope.rootRunId,
        "workflow.node.id": nodeId,
        "workflow.node.type": node.config.type,
      },
      {
        errorStatus: () => new Error(`Node "${nodeId}" failed`),
      },
    );
  }

  /** Executes a node's type-specific strategy. Always runs inside its `workflow.node` span. */
  private async dispatchNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const nodeId = node.id;
    this.config.onNodeStart?.(nodeId);

    if (node.config.skip) {
      const shouldSkip = await node.config.skip(context);
      abortSignal?.throwIfAborted();
      if (shouldSkip) {
        setActiveSpanAttributes({ "workflow.node.skipped": true });
        const state = this.config.stepExecutor.createSkippedState(nodeId);
        this.config.onNodeComplete?.(nodeId, state);
        return { state, contextPatch: createSetContextPatch(), waiting: false };
      }
    }

    const config = node.config;

    switch (config.type) {
      case "step":
        return this.executeStepNode(node, context, scope.executionRunId, abortSignal);
      case "parallel":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            this.executeParallelNode(node, config, context, nodeStates, scope, attemptSignal),
        });
      case "map":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            executeMapNodeStrategy({
              node,
              config,
              context,
              nodeStates,
              parentNodeIds: scope.declaredNodeIds,
              runtime: {
                // Map children ride the parent node-state map like parallel
                // children, so the root-keyspace flag is inherited unchanged.
                executeChildGraph: (nodes, run, options) =>
                  this.executeChildGraph(nodes, run, scope, options, attemptSignal),
                selectChildNodeStates: (nodes, states) =>
                  createCompositeNodeStateView(
                    nodes,
                    states,
                    scope.subWorkflowPath,
                    node.id,
                    context,
                    scope,
                    node,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
              },
            }),
        });
      case "branch": {
        // A composite retry is another attempt at the same selected branch.
        // Cache the first successful condition result so context produced by a
        // partially successful child cannot switch the retry to the other arm.
        let hasSelectedBranch = false;
        let selectedBranch = false;
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            if (!hasSelectedBranch) {
              selectedBranch = await config.condition(context);
              attemptSignal.throwIfAborted();
              hasSelectedBranch = true;
            }
            return await this.executeBranchNode(
              node,
              config,
              selectedBranch,
              context,
              nodeStates,
              scope,
              attemptSignal,
            );
          },
        });
      }
      case "wait":
        return this.executeWaitNode(node, config, context, abortSignal);
      case "subWorkflow":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            this.executeSubWorkflowNode(node, config, context, nodeStates, scope, attemptSignal),
        });
      case "loop":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            executeLoopNodeStrategy({
              node,
              config,
              context,
              nodeStates,
              parentNodeIds: scope.declaredNodeIds,
              runtime: {
                executeChildGraph: (nodes, run) =>
                  this.executeChildGraph(
                    nodes,
                    run,
                    { ...scope, rootKeyspace: false },
                    undefined,
                    attemptSignal,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
              },
            }),
        });
      default:
        throw INVALID_ARGUMENT.create({
          detail:
            `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            "Valid types are: step, parallel, map, branch, wait, subWorkflow, loop",
        });
    }
  }

  private async executeStepNode(
    node: WorkflowNode,
    context: WorkflowContext,
    runId: string,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const result = await this.config.stepExecutor.execute(
      node,
      context,
      abortSignal,
      runId,
    );
    abortSignal?.throwIfAborted();

    const state: NodeState = {
      nodeId: node.id,
      status: result.success ? "completed" : "failed",
      input: context.input,
      output: result.output,
      error: result.error,
      attempt: 1,
      startedAt: new Date(Date.now() - result.executionTime),
      completedAt: new Date(),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextPatch: createSetContextPatch(result.success ? { [node.id]: result.output } : {}),
      waiting: false,
    };
  }

  private async executeParallelNode(
    node: WorkflowNode,
    config: ParallelNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();
    const parallelNodeStates = createCompositeNodeStateView(
      config.nodes,
      nodeStates,
      scope.subWorkflowPath,
      node.id,
      context,
      scope,
    );

    const result = await this.executeUnwrapped(
      config.nodes,
      {
        id: `${node.id}_parallel`,
        workflowId: "",
        status: "running",
        input: context.input,
        // Carry already-accumulated child states so completed children are
        // skipped on resume instead of re-executing (H8).
        nodeStates: parallelNodeStates,
        currentNodes: [],
        context,
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      scope,
      undefined,
      abortSignal,
    );
    abortSignal?.throwIfAborted();

    // Keep successful child work inside this isolated composite transaction so
    // a parent retry can skip completed children without losing their context.
    // The outer batch commits this snapshot only if the composite eventually
    // completes or waits; a final failed state discards it in full.
    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch(parallelNodeStates, result.nodeStates));
    recordCompositeAttemptChildIds(nodeStates, node.id, Object.keys(result.nodeStates));

    const stalledWaitingNodes = result.stalledWaitNodes ??
      (result.stalledWaitNode === undefined
        ? undefined
        : [{ nodeId: result.stalledWaitNode, waitConfig: undefined }]);
    const waitingNodes = result.waitingNodes ?? stalledWaitingNodes;
    const waiting = result.waiting || waitingNodes !== undefined;
    const waitingNode = result.waitingNode ?? waitingNodes?.[0]?.nodeId;
    const waitingConfig = result.waitingConfig ?? waitingNodes?.[0]?.waitConfig;

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, waiting),
      output: result.context,
      error: waiting ? undefined : result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(waitingNodes === undefined ? {} : {
        _activeCompositeChildIds: [
          ...new Set([
            ...(nodeStates[node.id]?._activeCompositeChildIds ?? []),
            ...Object.keys(result.nodeStates),
          ]),
        ],
      }),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextPatch: result.contextPatch,
      waiting,
      errorCause: waiting ? undefined : result.errorCause,
      waitingNode,
      waitingConfig,
      waitingNodes,
    };
  }

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    conditionResult: boolean,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    const branchNodes = conditionResult ? config.then : (config.else ?? []);

    if (branchNodes.length === 0) {
      const state: NodeState = {
        nodeId: node.id,
        status: "completed",
        output: { branch: conditionResult ? "then" : "else", skipped: true },
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };

      return { state, contextPatch: createSetContextPatch(), waiting: false };
    }

    const branchNodeStates = createCompositeNodeStateView(
      branchNodes,
      nodeStates,
      scope.subWorkflowPath,
      node.id,
      context,
      scope,
    );

    const result = await this.executeUnwrapped(
      branchNodes,
      {
        id: `${node.id}_branch`,
        workflowId: "",
        status: "running",
        input: context.input,
        // Carry already-accumulated child states so completed children are
        // skipped on resume instead of re-executing (H8).
        nodeStates: branchNodeStates,
        currentNodes: [],
        context,
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      scope,
      undefined,
      abortSignal,
    );
    abortSignal?.throwIfAborted();

    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch(branchNodeStates, result.nodeStates));
    recordCompositeAttemptChildIds(nodeStates, node.id, Object.keys(result.nodeStates));

    const stalledWaitingNodes = result.stalledWaitNodes ??
      (result.stalledWaitNode === undefined
        ? undefined
        : [{ nodeId: result.stalledWaitNode, waitConfig: undefined }]);
    const waitingNodes = result.waitingNodes ?? stalledWaitingNodes;
    const waiting = result.waiting || waitingNodes !== undefined;
    const waitingNode = result.waitingNode ?? waitingNodes?.[0]?.nodeId;
    const waitingConfig = result.waitingConfig ?? waitingNodes?.[0]?.waitConfig;

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, waiting),
      output: {
        branch: conditionResult ? "then" : "else",
        result: result.context,
      },
      error: waiting ? undefined : result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(waitingNodes === undefined ? {} : {
        _activeCompositeChildIds: [
          ...new Set([
            ...(nodeStates[node.id]?._activeCompositeChildIds ?? []),
            ...Object.keys(result.nodeStates),
          ]),
        ],
      }),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextPatch: result.contextPatch,
      waiting,
      errorCause: waiting ? undefined : result.errorCause,
      waitingNode,
      waitingConfig,
      waitingNodes,
    };
  }

  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    this.config.onWaiting?.(node.id, config);

    const payload = typeof config.payload === "function"
      ? await config.payload(context)
      : config.payload;
    abortSignal?.throwIfAborted();

    const state: NodeState = {
      nodeId: node.id,
      status: "running",
      _waitInstanceId: generateId("wait"),
      // Absent optional fields are left out rather than written as `undefined`.
      // A suspended loop stores its child states in the context, where JSON
      // drops those keys, so writing them had the persistence check report the
      // framework's own empty fields as user-authored lossy values.
      input: {
        type: config.waitType,
        ...(config.eventName !== undefined ? { eventName: config.eventName } : {}),
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        ...(config.message !== undefined ? { message: config.message } : {}),
        ...(payload !== undefined ? { payload } : {}),
      },
      attempt: 1,
      startedAt: new Date(),
    };

    return {
      state,
      contextPatch: createSetContextPatch(),
      waiting: true,
      waitingConfig: config,
    };
  }

  private async executeSubWorkflowNode(
    node: WorkflowNode,
    config: SubWorkflowNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    if (typeof config.workflow === "string") {
      throw NOT_SUPPORTED.create({
        detail:
          "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      });
    }

    const workflowDef = config.workflow;

    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);
    abortSignal?.throwIfAborted();

    const steps = typeof workflowDef.steps === "function"
      ? workflowDef.steps({ input, context })
      : workflowDef.steps;
    abortSignal?.throwIfAborted();

    const ownerPath = subWorkflowOwnerPath(scope.subWorkflowPath, node.id);
    scope.subWorkflowReservationOwners.set(ownerPath, node.id);

    // A sub-workflow is a separate definition with its own id space, so a child
    // may legally repeat an id declared by an ancestor graph -- duplicate-id
    // validation is per-graph. That makes the collision ambiguous here: the
    // scheduler treats any completed or skipped state as a satisfied node, so a
    // completed ancestor `review` would mark a nested `waitForApproval("review")`
    // done and let its dependents publish without ever raising the approval.
    // Refuse the run instead, matching how map and loop reject generated child
    // ids that collide with the parent graph.
    const childNodeIds = collectSubWorkflowNodeIds(steps, nodeStates);
    const collidingChildId = [...childNodeIds].find((childId) =>
      scope.declaredNodeIds.has(childId)
    );
    if (collidingChildId) {
      throw INVALID_ARGUMENT.create({
        detail: `SubWorkflow node "${node.id}" declares child id "${collidingChildId}", ` +
          "which collides with a declared node in the parent graph",
      });
    }

    // Carry forward only the states this sub-workflow itself produced, so a
    // completed ancestor node can never stand in for a child that shares its id
    // on a path the static check above cannot see (a nested loop whose steps are
    // generated at runtime). Everything else stays out of the child keyspace.
    const { seededNodeStates, ownedNodeIds } = createSeededSubWorkflowNodeStates(
      ownerPath,
      childNodeIds,
      nodeStates,
      scope,
    );

    const subRunId = `${node.id}_sub_${generateId()}`;
    // The sub-run record is synthetic and never persisted, so its id is a debugging
    // attribute only — `workflow.run_id` keeps pointing at the root run.
    setActiveSpanAttributes({
      "workflow.sub_run_id": subRunId,
      "workflow.sub_workflow_id": workflowDef.id,
    });

    const result = await this.executeUnwrapped(
      steps,
      {
        id: subRunId,
        workflowId: workflowDef.id,
        status: "running",
        input,
        nodeStates: seededNodeStates,
        currentNodes: [],
        context: { input },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      { ...scope, subWorkflowPath: ownerPath },
      undefined,
      abortSignal,
    );
    abortSignal?.throwIfAborted();

    // Tag every newly produced state with its owner path. This metadata survives
    // executor restarts, when the in-memory ownership map is rebuilt from the
    // persisted root node-state map. Nested states retain their more specific
    // owner path so an enclosing sub-workflow can still rehydrate them.
    const { ownedResultNodeStates, producedNodeIds } = ownSubWorkflowResultNodeStates(
      result.nodeStates,
      ownerPath,
      scope.declaredNodeIds,
      ownedNodeIds,
    );
    // A map materializes each WorkflowDefinition item as a generated
    // sub-workflow wrapper. Track that wrapper too, or its completed ownerless
    // state can be seeded into a later sibling that declares the same child id.
    producedNodeIds.add(node.id);
    scope.subWorkflowNodeIds.set(ownerPath, producedNodeIds);

    // Diff the sub-run against the states it actually started from. Diffing the
    // parent's whole map would report every state withheld above as deleted and
    // strand the nodes that produced them.
    applyRecordPatch(nodeStates, createRecordPatch(seededNodeStates, ownedResultNodeStates));

    const stalledWaitingNodes = result.stalledWaitNodes ??
      (result.stalledWaitNode === undefined
        ? undefined
        : [{ nodeId: result.stalledWaitNode, waitConfig: undefined }]);
    const waitingNodes = result.waitingNodes ?? stalledWaitingNodes;
    const waiting = result.waiting || waitingNodes !== undefined;
    const waitingNode = result.waitingNode ?? waitingNodes?.[0]?.nodeId;
    const waitingConfig = result.waitingConfig ?? waitingNodes?.[0]?.waitConfig;

    let finalOutput: unknown = result.context;
    if (result.completed && config.output) {
      finalOutput = config.output(result.context);
      abortSignal?.throwIfAborted();
    }

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, waiting),
      output: finalOutput,
      error: waiting ? undefined : result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(waiting
        ? {
          _activeCompositeChildIds: [
            ...new Set([
              ...(nodeStates[node.id]?._activeCompositeChildIds ?? []),
              ...Object.keys(result.nodeStates),
            ]),
          ],
        }
        : {}),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextPatch: createSetContextPatch(result.completed ? { [node.id]: finalOutput } : {}),
      waiting,
      errorCause: waiting ? undefined : result.errorCause,
      waitingNode,
      waitingConfig,
      waitingNodes,
    };
  }

  private async checkpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    ownership?: CheckpointOwnership,
  ): Promise<void> {
    if (!this.config.checkpointManager) {
      return;
    }

    const checkpointValue = {
      id: generateId("cp"),
      nodeId,
      timestamp: new Date(),
      context,
      nodeStates,
    };
    const checkpoint = ownership
      ? cloneOwnedCheckpointForPersistence(checkpointValue)
      : cloneCheckpointForPersistence(checkpointValue);

    const saved = await this.config.checkpointManager.save(runId, checkpoint, ownership);
    // Legacy test/double implementations returned void. Only an explicit false
    // from the owner-aware CheckpointManager means the fenced append was denied.
    if (saved === false) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow execution ownership changed before checkpoint persistence",
        context: { ownershipLost: true },
      });
    }
  }

  private async executeChildGraph(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    scope: ExecutionScope,
    options?: ChildGraphExecutionOptions,
    abortSignal?: AbortSignal,
  ): Promise<DAGInternalExecutionResult> {
    if (!options?.maxConcurrency) {
      return await this.executeUnwrapped(nodes, run, scope, undefined, abortSignal);
    }

    // Run the child graph on a scoped executor rather than mutating
    // this.config.maxConcurrency. Concurrent child graphs (e.g. parallel map
    // nodes) would otherwise race on the shared field and leave the parent
    // executor's concurrency permanently corrupted.
    const childExecutor = new DAGExecutor({
      ...this.config,
      maxConcurrency: options.maxConcurrency,
    });
    return await childExecutor.executeUnwrapped(nodes, run, scope, undefined, abortSignal);
  }
}
