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

/** Request payload for hosted runtime request config. */
export type HostedRuntimeRequestConfigRequest = Pick<
  HostedChatRequest,
  "model" | "forwardedProps" | "runtimeOverrides"
>;

/** Public API contract for hosted runtime request config agent. */
export type HostedRuntimeRequestConfigAgent = Pick<
  RuntimeAgentMarkdownDefinition,
  "model" | "thinking" | "temperature" | "maxSteps" | "tools" | "providerTools"
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  requestedTools: string[] | undefined;
}): string[] | undefined {
  if (input.requestedTools !== undefined) {
    return [...new Set(input.requestedTools)];
  }

  if (input.configuredTools === true) {
    return undefined;
  }

  return [...new Set(input.configuredTools ?? [])];
}

/** Resolve provider-native tool bindings without widening direct tool access. */
export function resolveHostedRuntimeAllowedProviderTools(input: {
  configuredProviderTools: RuntimeAgentMarkdownDefinition["providerTools"];
  requestedTools: string[] | undefined;
}): string[] {
  return [
    ...new Set(input.requestedTools ?? input.configuredProviderTools ?? []),
  ];
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

  return {
    effectiveRuntimeOverrides,
    requestedModel,
    clientProfile: resolveRuntimeClientProfile(input.request.forwardedProps),
    requestedThinking: resolveHostedRuntimeThinkingOverride({
      configuredThinking: input.resolveModelThinking?.(requestedModel) ??
        input.agentConfig.thinking,
      requestedThinking: effectiveRuntimeOverrides?.thinking,
    }),
    requestedTemperature: input.agentConfig.temperature,
    requestedMaxSteps: effectiveRuntimeOverrides?.maxSteps ??
      input.agentConfig.maxSteps,
    requestedMaxOutputTokens: effectiveRuntimeOverrides?.maxOutputTokens,
    requestedAllowedTools: resolveHostedRuntimeAllowedTools({
      configuredTools: input.agentConfig.tools,
      requestedTools: effectiveRuntimeOverrides?.allowedTools,
    }),
    requestedAllowedProviderTools: resolveHostedRuntimeAllowedProviderTools({
      configuredProviderTools: input.agentConfig.providerTools,
      requestedTools: effectiveRuntimeOverrides?.allowedTools,
    }),
    includeRuntimeEssentialToolsWhenEmpty: effectiveRuntimeOverrides?.allowedTools === undefined,
  };
}
