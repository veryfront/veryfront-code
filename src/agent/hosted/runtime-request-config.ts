import type { ChatRuntimeOverrides } from "../../chat/types.ts";
import { type HostedChatRequest, hostedChatRuntimeOverridesSchema } from "./chat-request.ts";
import type {
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentThinkingConfig,
} from "../runtime/agent-definition.ts";
import {
  resolveRuntimeClientProfile,
  type RuntimeClientProfile,
} from "../runtime/client-profile.ts";
import { AGENT_DELEGATE_TOOL_PREFIX } from "../runtime/agent-delegation-names.ts";
import {
  isSupportedToolExposureCheckpointVersion,
  type ToolExposureCheckpoint,
} from "../runtime/tool-exposure.ts";

/** Request payload for hosted runtime request config. */
export type HostedRuntimeRequestConfigRequest = Pick<
  HostedChatRequest,
  "model" | "forwardedProps" | "runtimeOverrides"
>;

/** Public API contract for hosted runtime request config agent. */
export type HostedRuntimeRequestConfigAgent = Pick<
  RuntimeAgentMarkdownDefinition,
  | "model"
  | "thinking"
  | "temperature"
  | "maxSteps"
  | "tools"
  | "deniedTools"
  | "providerTools"
  | "delegates"
  | "skills"
>;

/** Input payload for resolve hosted runtime request config. */
export type ResolveHostedRuntimeRequestConfigInput = {
  request: HostedRuntimeRequestConfigRequest;
  agentConfig: HostedRuntimeRequestConfigAgent;
  resolveModelId: (modelId: string | undefined) => string | undefined;
  resolveModelThinking?: (
    modelId: string | undefined,
  ) => RuntimeAgentThinkingConfig | undefined;
};

/** Configuration used by resolved hosted runtime request. */
export type ResolvedHostedRuntimeRequestConfig = {
  effectiveRuntimeOverrides: ChatRuntimeOverrides | undefined;
  requestedModel: string | undefined;
  clientProfile: RuntimeClientProfile | null;
  requestedThinking: RuntimeAgentThinkingConfig | undefined;
  requestedTemperature: number | undefined;
  requestedMaxSteps: number | undefined;
  requestedMaxOutputTokens: number | undefined;
  requestedAllowedTools: string[] | undefined;
  requestedAllowedProviderTools: string[];
  includeRuntimeEssentialToolsWhenEmpty: boolean;
  /** Tool names the agent config denied explicitly; never re-added downstream. */
  deniedToolNames: string[] | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read the latest checkpoint overwritten by the authenticated server caller. */
export function getServerResolvedToolExposureCheckpoint(
  forwardedProps: Record<string, unknown> | undefined,
  serverEnvelopeVerified: boolean,
): ToolExposureCheckpoint | undefined {
  if (!serverEnvelopeVerified) return undefined;
  const value = forwardedProps?.serverResolvedToolExposureCheckpoint;
  if (
    !isRecord(value) ||
    !isSupportedToolExposureCheckpointVersion(value.version) ||
    !Array.isArray(value.loadedToolNames) ||
    !value.loadedToolNames.every((name) => typeof name === "string" && name.length > 0) ||
    new Set(value.loadedToolNames).size !== value.loadedToolNames.length
  ) {
    return undefined;
  }
  return {
    version: value.version,
    loadedToolNames: [...value.loadedToolNames],
  };
}

/** Return forwarded hosted model ID. */
export function getForwardedHostedModelId(
  forwardedProps: Record<string, unknown> | undefined,
): string | undefined {
  return typeof forwardedProps?.model === "string" &&
      forwardedProps.model.trim().length > 0
    ? forwardedProps.model
    : undefined;
}

/** Return forwarded hosted runtime overrides. */
export function getForwardedHostedRuntimeOverrides(
  forwardedProps: Record<string, unknown> | undefined,
): ChatRuntimeOverrides | undefined {
  const runtimeOverrides = forwardedProps?.runtimeOverrides;
  const parsedRuntimeOverrides = isRecord(runtimeOverrides)
    ? hostedChatRuntimeOverridesSchema.safeParse(runtimeOverrides)
    : undefined;
  if (parsedRuntimeOverrides && !parsedRuntimeOverrides.success) {
    return undefined;
  }

  const maxOutputTokens = forwardedProps?.maxOutputTokens;
  const forwardedMaxOutputTokens = typeof maxOutputTokens === "number" &&
      Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0
    ? maxOutputTokens
    : undefined;
  const overrides = {
    ...(parsedRuntimeOverrides?.success ? parsedRuntimeOverrides.data : {}),
    ...(forwardedMaxOutputTokens !== undefined &&
        parsedRuntimeOverrides?.data.maxOutputTokens === undefined
      ? { maxOutputTokens: forwardedMaxOutputTokens }
      : {}),
  };

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** Resolves hosted runtime thinking override. */
export function resolveHostedRuntimeThinkingOverride(input: {
  configuredThinking: RuntimeAgentThinkingConfig | undefined;
  requestedThinking: false | number | undefined;
}): RuntimeAgentThinkingConfig | undefined {
  if (input.requestedThinking === undefined) {
    return input.configuredThinking;
  }

  if (input.requestedThinking === false) {
    return { enabled: false };
  }

  return {
    enabled: true,
    budgetTokens: input.requestedThinking,
  };
}

/** Resolve the explicit request tool selector or fall back to configured agent bindings. */
export function resolveHostedRuntimeAllowedTools(input: {
  configuredTools: RuntimeAgentMarkdownDefinition["tools"];
  configuredDeniedTools?: RuntimeAgentMarkdownDefinition["deniedTools"];
  configuredDelegates: RuntimeAgentMarkdownDefinition["delegates"];
  configuredSkills: RuntimeAgentMarkdownDefinition["skills"];
  requestedTools: string[] | undefined;
}): string[] | undefined {
  if (input.configuredTools === true) {
    if (input.configuredDeniedTools?.length) return [];
    return input.requestedTools === undefined ? undefined : [...new Set(input.requestedTools)];
  }

  const configuredToolNames = new Set([
    ...(input.configuredTools ?? []),
    ...(input.configuredDelegates ?? []).map((id) => `${AGENT_DELEGATE_TOOL_PREFIX}${id}`),
  ]);
  if (input.requestedTools === undefined) {
    return [...configuredToolNames];
  }

  const hasImplicitLegacyDelegation = input.configuredSkills === undefined ||
    input.configuredSkills === true ||
    (Array.isArray(input.configuredSkills) && input.configuredSkills.length > 0);
  return [...new Set(input.requestedTools)].filter((toolName) =>
    configuredToolNames.has(toolName) ||
    (toolName === "invoke_agent" && hasImplicitLegacyDelegation)
  );
}

/** Resolve provider-native tool bindings without widening direct tool access. */
export function resolveHostedRuntimeAllowedProviderTools(input: {
  configuredProviderTools: RuntimeAgentMarkdownDefinition["providerTools"];
  requestedTools: string[] | undefined;
}): string[] {
  const configuredToolNames = new Set(input.configuredProviderTools ?? []);
  if (input.requestedTools === undefined) {
    return [...configuredToolNames];
  }

  return [...new Set(input.requestedTools)].filter((toolName) => configuredToolNames.has(toolName));
}

/** Configuration used by resolve hosted runtime request. */
export function resolveHostedRuntimeRequestConfig(
  input: ResolveHostedRuntimeRequestConfigInput,
): ResolvedHostedRuntimeRequestConfig {
  const effectiveRuntimeOverrides = input.request.runtimeOverrides ??
    getForwardedHostedRuntimeOverrides(input.request.forwardedProps);
  const requestedModel = input.resolveModelId(
    input.request.model ?? getForwardedHostedModelId(input.request.forwardedProps) ??
      input.agentConfig.model,
  );
  const failClosedUnrestrictedToolDenials = input.agentConfig.tools === true &&
    Boolean(input.agentConfig.deniedTools?.length);

  return {
    effectiveRuntimeOverrides,
    requestedModel,
    clientProfile: resolveRuntimeClientProfile(input.request.forwardedProps),
    requestedThinking: resolveHostedRuntimeThinkingOverride({
      configuredThinking: input.agentConfig.thinking ??
        input.resolveModelThinking?.(requestedModel),
      requestedThinking: effectiveRuntimeOverrides?.thinking,
    }),
    requestedTemperature: input.agentConfig.temperature,
    requestedMaxSteps: effectiveRuntimeOverrides?.maxSteps ??
      input.agentConfig.maxSteps,
    requestedMaxOutputTokens: effectiveRuntimeOverrides?.maxOutputTokens,
    requestedAllowedTools: resolveHostedRuntimeAllowedTools({
      configuredTools: input.agentConfig.tools,
      configuredDeniedTools: input.agentConfig.deniedTools,
      configuredDelegates: input.agentConfig.delegates,
      configuredSkills: input.agentConfig.skills,
      requestedTools: effectiveRuntimeOverrides?.allowedTools,
    }),
    requestedAllowedProviderTools: resolveHostedRuntimeAllowedProviderTools({
      configuredProviderTools: input.agentConfig.providerTools,
      requestedTools: effectiveRuntimeOverrides?.allowedTools,
    }),
    includeRuntimeEssentialToolsWhenEmpty: !failClosedUnrestrictedToolDenials &&
      effectiveRuntimeOverrides?.allowedTools === undefined,
    deniedToolNames: input.agentConfig.deniedTools?.length
      ? [...input.agentConfig.deniedTools]
      : undefined,
  };
}
