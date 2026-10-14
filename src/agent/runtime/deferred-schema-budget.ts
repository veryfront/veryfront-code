import type { Message } from "../types.ts";
import { isProviderNativeToolExposureDefinition } from "./provider-native-tool-inventory.ts";
import {
  createToolSearchDefinition,
  TOOL_SEARCH_TOOL_NAME,
  type ToolExposurePlan,
} from "./tool-exposure.ts";

type BudgetInspection = {
  readonly fits: boolean;
  readonly outputExceeded: boolean;
  readonly estimatedInputTokens: number | null;
};

function protectedToolNames(messages: readonly Message[], plan: ToolExposurePlan): Set<string> {
  const pending = new Map<string, string>();
  let latestCallNames = new Set<string>();
  const awaitingFirstUse = new Set<string>();
  // A newer search step supersedes schemas the model already skipped once.
  let modelStepSinceSearch = false;
  for (const message of messages) {
    if (message.role === "user") {
      // A newer user turn ends the previous tool opportunity, so its
      // just-called and just-searched schemas no longer need protection.
      latestCallNames = new Set();
      awaitingFirstUse.clear();
      modelStepSinceSearch = false;
    }
    const names = new Set<string>();
    for (const part of message.parts) {
      if (part.type === "tool-result") {
        pending.delete(part.toolCallId);
        if ("result" in part && part.toolName === TOOL_SEARCH_TOOL_NAME) {
          const result = part.result;
          if (
            result && typeof result === "object" && "matches" in result &&
            Array.isArray(result.matches)
          ) {
            if (modelStepSinceSearch) awaitingFirstUse.clear();
            modelStepSinceSearch = false;
            for (const match of result.matches) {
              if (
                match && typeof match === "object" && match.status === "loaded" &&
                typeof match.name === "string"
              ) awaitingFirstUse.add(match.name);
            }
          }
        }
      } else if (part.type.startsWith("tool-") && "toolCallId" in part) {
        pending.set(part.toolCallId, part.toolName);
        names.add(part.toolName);
        awaitingFirstUse.delete(part.toolName);
      }
    }
    if (names.size > 0) {
      latestCallNames = names;
      modelStepSinceSearch = true;
    }
  }
  const protectedNames = new Set([...latestCallNames, ...pending.values(), ...awaitingFirstUse]);
  // A schema returned by tool_search has not yet had a chance to be called.
  if (latestCallNames.has(TOOL_SEARCH_TOOL_NAME) && awaitingFirstUse.size === 0) {
    const loaded = [...plan.loadedToolNames];
    const newest = loaded[loaded.length - 1];
    if (newest !== undefined) protectedNames.add(newest);
  }
  return protectedNames;
}

/** Fit previously loaded deferred schemas without changing source history or authorization. */
export function fitDeferredToolSchemasToBudget(input: {
  plan: ToolExposurePlan;
  sourceMessages: readonly Message[];
  inspect: (plan: ToolExposurePlan) => BudgetInspection;
}): { plan: ToolExposurePlan; evictedNames: string[] } {
  let plan = input.plan;
  let budget = input.inspect(plan);
  const evictedNames: string[] = [];
  if (budget.fits || budget.outputExceeded || budget.estimatedInputTokens === null) {
    return { plan, evictedNames };
  }

  const protectedNames = protectedToolNames(input.sourceMessages, plan);
  for (const name of plan.loadedToolNames) {
    if (protectedNames.has(name)) continue;
    const tool = plan.visible.find((entry) => entry.name === name);
    if (!tool || isProviderNativeToolExposureDefinition(tool)) continue;
    const loadedToolNames = new Set(plan.loadedToolNames);
    loadedToolNames.delete(name);
    const visible = plan.visible.filter((entry) => entry.name !== name);
    if (!visible.some((entry) => entry.name === TOOL_SEARCH_TOOL_NAME)) {
      visible.push(createToolSearchDefinition());
    }
    visible.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const deferred = [...plan.deferred, tool];
    deferred.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const candidate: ToolExposurePlan = { ...plan, loadedToolNames, visible, deferred };
    const nextBudget = input.inspect(candidate);
    const currentEstimate = budget.estimatedInputTokens;
    if (
      currentEstimate === null || nextBudget.outputExceeded ||
      nextBudget.estimatedInputTokens === null ||
      (nextBudget.estimatedInputTokens >= currentEstimate && !nextBudget.fits)
    ) continue;
    plan = candidate;
    budget = nextBudget;
    evictedNames.push(name);
    if (budget.fits) break;
  }
  return { plan, evictedNames };
}
