import type { HostToolSet } from "#veryfront/tool";

import {
  type HostedChildFileWriteFallbackLogger,
  isHostedChildTextProjectArtifactPrompt,
  withHostedChildRerunnableFileWriteFallbacks,
} from "./child-artifact-support.ts";
import {
  type HostedChildSteeringMutationHandler,
  wrapHostedChildSteeringMutationTool,
} from "./child-steering-tools.ts";
import { getForkRuntimeAllowedToolNames } from "../provider-native-tool-inventory.ts";
import {
  PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES,
  type ProjectSteeringPaths,
} from "../project-steering-mutation.ts";

export interface HostedChildRequestedToolsInput {
  prompt: string;
  requestedTools?: readonly string[];
  excludedTools?: ReadonlySet<string>;
  companionTools?: Readonly<Record<string, readonly string[]>>;
  sandboxToolNames?: readonly string[];
  artifactToolNames?: readonly string[];
  sandboxRequiredCuePattern?: RegExp;
  isTextArtifactPrompt?: (prompt: string) => boolean;
}

const DEFAULT_SANDBOX_TOOL_NAMES = ["bash", "readFile", "writeFile"];
const DEFAULT_ARTIFACT_TOOL_NAMES = ["create_file", "update_file"];

export const DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "studio_panel_control",
  "studio_suggestions",
  "form_input",
]);

export const DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS: Readonly<
  Record<string, readonly string[]>
> = {
  create_file: ["update_file"],
  update_file: ["create_file"],
};

export const DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN =
  /\b(bash|shell|terminal|command line|cli|\/workspace|workspace\/|python|node|npm|pnpm|yarn|curl|jq|csv|json|pdf|zip|unzip|archive|repo|git|test|build|script)\b/i;

export function sanitizeHostedChildRequestedTools(
  input: HostedChildRequestedToolsInput,
): string[] | undefined {
  const expandedTools = expandHostedChildRequestedTools({
    requestedTools: input.requestedTools,
    excludedTools: input.excludedTools,
    companionTools: input.companionTools,
  });
  if (!expandedTools) {
    return expandedTools;
  }

  if (
    !shouldPruneSandboxToolsFromHostedChildRequest({
      prompt: input.prompt,
      requestedTools: expandedTools,
      sandboxToolNames: input.sandboxToolNames ?? DEFAULT_SANDBOX_TOOL_NAMES,
      artifactToolNames: input.artifactToolNames ?? DEFAULT_ARTIFACT_TOOL_NAMES,
      sandboxRequiredCuePattern: input.sandboxRequiredCuePattern,
      isTextArtifactPrompt: input.isTextArtifactPrompt,
    })
  ) {
    return expandedTools;
  }

  const sandboxToolNames = new Set(input.sandboxToolNames ?? DEFAULT_SANDBOX_TOOL_NAMES);
  return expandedTools.filter((toolName) => !sandboxToolNames.has(toolName));
}

export function expandHostedChildRequestedTools(input: {
  requestedTools?: readonly string[];
  excludedTools?: ReadonlySet<string>;
  companionTools?: Readonly<Record<string, readonly string[]>>;
}): string[] | undefined {
  if (!input.requestedTools) {
    return undefined;
  }

  if (input.requestedTools.length === 0) {
    return [];
  }

  const expandedTools = new Set<string>();

  for (const toolName of input.requestedTools) {
    if (input.excludedTools?.has(toolName)) {
      continue;
    }

    expandedTools.add(toolName);

    for (const companionTool of input.companionTools?.[toolName] ?? []) {
      if (input.excludedTools?.has(companionTool)) {
        continue;
      }

      expandedTools.add(companionTool);
    }
  }

  return [...expandedTools];
}

export function shouldPruneSandboxToolsFromHostedChildRequest(input: {
  prompt: string;
  requestedTools?: readonly string[];
  sandboxToolNames?: readonly string[];
  artifactToolNames?: readonly string[];
  sandboxRequiredCuePattern?: RegExp;
  isTextArtifactPrompt?: (prompt: string) => boolean;
}): boolean {
  const requestedTools = input.requestedTools;
  if (!requestedTools?.length) {
    return false;
  }

  const sandboxToolNames = input.sandboxToolNames ?? DEFAULT_SANDBOX_TOOL_NAMES;
  if (!sandboxToolNames.some((toolName) => requestedTools.includes(toolName))) {
    return false;
  }

  const artifactToolNames = input.artifactToolNames ?? DEFAULT_ARTIFACT_TOOL_NAMES;
  if (!artifactToolNames.some((toolName) => requestedTools.includes(toolName))) {
    return false;
  }

  if (!input.isTextArtifactPrompt?.(input.prompt)) {
    return false;
  }

  if (!input.sandboxRequiredCuePattern) {
    return true;
  }

  return !matchesSandboxRequiredCue(input.sandboxRequiredCuePattern, input.prompt);
}

export type HostedChildForkRuntimeToolSelectionResult =
  | {
    ok: true;
    forkTools: HostToolSet;
  }
  | {
    ok: false;
    errorMessage: string;
  };

export type DefaultHostedChildForkRuntimeToolPreparationResult =
  | {
    ok: true;
    forkTools: HostToolSet;
    availableToolNames: string[];
  }
  | {
    ok: false;
    errorMessage: string;
  };

export type DefaultHostedChildForkToolAssemblySourceResult =
  | {
    ok: true;
    forkTools: HostToolSet;
    closeTooling?: () => Promise<void>;
    closeRuntime?: () => Promise<void>;
  }
  | {
    ok: false;
    errorMessage: string;
  };

export type DefaultHostedChildForkToolAssemblyResult =
  | {
    ok: true;
    forkTools: HostToolSet;
    availableToolNames: string[];
    closeTooling?: () => Promise<void>;
    closeRuntime?: () => Promise<void>;
  }
  | {
    ok: false;
    errorMessage: string;
  };

export function selectHostedChildForkRuntimeTools(input: {
  provider: string;
  forkModel?: string;
  forkTools: HostToolSet;
  requestedTools?: readonly string[];
}): HostedChildForkRuntimeToolSelectionResult {
  if (!input.requestedTools?.length) {
    return {
      ok: true,
      forkTools: input.forkTools,
    };
  }

  const availableNames = new Set(
    getForkRuntimeAllowedToolNames({
      provider: input.provider,
      forkModel: input.forkModel,
      forkTools: input.forkTools,
    }),
  );
  const unavailableRequested = input.requestedTools.filter((toolName) =>
    !availableNames.has(toolName)
  );
  if (unavailableRequested.length > 0) {
    return {
      ok: false,
      errorMessage: `Requested fork tools not available in runtime: ${
        unavailableRequested.join(", ")
      }. Available: ${[...availableNames].sort().join(", ")}.`,
    };
  }

  const allowedSet = new Set(input.requestedTools);
  const forkTools: HostToolSet = {};
  for (const [toolName, toolDefinition] of Object.entries(input.forkTools)) {
    if (allowedSet.has(toolName)) {
      forkTools[toolName] = toolDefinition;
    }
  }

  return {
    ok: true,
    forkTools,
  };
}

export function sanitizeDefaultHostedChildRequestedTools(input: {
  prompt: string;
  requestedTools?: readonly string[];
}): string[] | undefined {
  return sanitizeHostedChildRequestedTools({
    prompt: input.prompt,
    requestedTools: input.requestedTools,
    excludedTools: DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES,
    companionTools: DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS,
    sandboxRequiredCuePattern: DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN,
    isTextArtifactPrompt: isHostedChildTextProjectArtifactPrompt,
  });
}

export function selectDefaultHostedChildForkRuntimeTools(input: {
  provider: string;
  forkModel?: string;
  forkTools: HostToolSet;
  effectivePrompt: string;
  requestedTools?: readonly string[];
}): HostedChildForkRuntimeToolSelectionResult {
  const effectiveRequestedTools = sanitizeDefaultHostedChildRequestedTools({
    prompt: input.effectivePrompt,
    requestedTools: input.requestedTools,
  });

  return selectHostedChildForkRuntimeTools({
    provider: input.provider,
    forkModel: input.forkModel,
    forkTools: input.forkTools,
    requestedTools: effectiveRequestedTools,
  });
}

export function prepareDefaultHostedChildForkRuntimeTools(input: {
  provider: string;
  forkModel?: string;
  forkTools: HostToolSet;
  effectivePrompt: string;
  requestedTools?: readonly string[];
  activeProjectId?: string | null;
  activeBranchId?: string | null;
  steeringPaths?: ProjectSteeringPaths;
  onSteeringMutation?: HostedChildSteeringMutationHandler;
  logger?: HostedChildFileWriteFallbackLogger;
}): DefaultHostedChildForkRuntimeToolPreparationResult {
  const selectedTools = selectDefaultHostedChildForkRuntimeTools({
    provider: input.provider,
    forkModel: input.forkModel,
    forkTools: input.forkTools,
    effectivePrompt: input.effectivePrompt,
    requestedTools: input.requestedTools,
  });
  if (!selectedTools.ok) {
    return selectedTools;
  }

  let forkTools = selectedTools.forkTools;
  const availableToolNames = Object.keys(forkTools);
  forkTools = withHostedChildRerunnableFileWriteFallbacks({
    tools: forkTools,
    logger: input.logger,
  });

  for (const toolName of PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES) {
    const toolDefinition = forkTools[toolName];
    if (!toolDefinition) {
      continue;
    }

    forkTools[toolName] = wrapHostedChildSteeringMutationTool({
      toolName,
      toolDefinition,
      activeProjectId: input.activeProjectId,
      activeBranchId: input.activeBranchId,
      steeringPaths: input.steeringPaths,
      onMutation: input.onSteeringMutation,
    });
  }

  return {
    ok: true,
    forkTools,
    availableToolNames,
  };
}

export async function prepareDefaultHostedChildForkToolAssembly(input: {
  prepareToolSources: () => Promise<DefaultHostedChildForkToolAssemblySourceResult>;
  provider: string;
  forkModel?: string;
  effectivePrompt: string;
  requestedTools?: readonly string[];
  activeProjectId?: string | null;
  activeBranchId?: string | null;
  steeringPaths?: ProjectSteeringPaths;
  onSteeringMutation?: HostedChildSteeringMutationHandler;
  logger?: HostedChildFileWriteFallbackLogger;
}): Promise<DefaultHostedChildForkToolAssemblyResult> {
  const toolSources = await input.prepareToolSources();
  if (!toolSources.ok) {
    return toolSources;
  }

  const preparedTools = prepareDefaultHostedChildForkRuntimeTools({
    provider: input.provider,
    forkModel: input.forkModel,
    forkTools: toolSources.forkTools,
    effectivePrompt: input.effectivePrompt,
    requestedTools: input.requestedTools,
    activeProjectId: input.activeProjectId,
    activeBranchId: input.activeBranchId,
    steeringPaths: input.steeringPaths,
    onSteeringMutation: input.onSteeringMutation,
    logger: input.logger,
  });
  if (!preparedTools.ok) {
    await toolSources.closeTooling?.();
    await toolSources.closeRuntime?.();
    return preparedTools;
  }

  return {
    ok: true,
    forkTools: preparedTools.forkTools,
    availableToolNames: preparedTools.availableToolNames,
    closeTooling: toolSources.closeTooling,
    closeRuntime: toolSources.closeRuntime,
  };
}

export function buildDefaultHostedChildForkToolSet(
  ...toolSets: readonly HostToolSet[]
): HostToolSet {
  const allTools: HostToolSet = {};
  for (const toolSet of toolSets) {
    Object.assign(allTools, toolSet);
  }

  const forkTools: HostToolSet = {};
  for (
    const [toolName, toolDefinition] of Object.entries(allTools).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) {
    if (DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES.has(toolName)) {
      continue;
    }

    forkTools[toolName] = toolDefinition;
  }

  return forkTools;
}

export function buildHostedChildToolDescription(): string {
  return `Invoke a focused child agent on an isolated subtask.
Call multiple times in one response to run child agents in parallel.

Use when:
- Work can be isolated from the main conversation
- You need focused context without polluting the main thread
- A subtask benefits from different tools, model, or step limits
- You want the child result returned back to the main thread

This uses the shared child-run execution engine. Prefer this as the long-term child-work primitive.`;
}

function matchesSandboxRequiredCue(pattern: RegExp, prompt: string): boolean {
  const deterministicFlags = [...pattern.flags]
    .filter((flag) => flag !== "g" && flag !== "y")
    .join("");

  return new RegExp(pattern.source, deterministicFlags).test(prompt);
}
