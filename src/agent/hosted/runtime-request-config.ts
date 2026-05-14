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

export type HostedRuntimeRequestConfigRequest = Pick<
  HostedChatRequest,
  "model" | "forwardedProps" | "runtimeOverrides"
>;

export type HostedRuntimeRequestConfigAgent = Pick<
  RuntimeAgentMarkdownDefinition,
  "model" | "thinking" | "maxSteps"
>;

export type ResolveHostedRuntimeRequestConfigInput = {
  request: HostedRuntimeRequestConfigRequest;
  agentConfig: HostedRuntimeRequestConfigAgent;
  resolveModelId: (modelId: string | undefined) => string | undefined;
  resolveModelThinking?: (
    modelId: string | undefined,
  ) => RuntimeAgentThinkingConfig | undefined;
};

export type ResolvedHostedRuntimeRequestConfig = {
  effectiveRuntimeOverrides: ChatRuntimeOverrides | undefined;
  requestedModel: string | undefined;
  clientProfile: RuntimeClientProfile | null;
  requestedThinking: RuntimeAgentThinkingConfig | undefined;
  requestedMaxSteps: number | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getForwardedHostedModelId(
  forwardedProps: Record<string, unknown> | undefined,
): string | undefined {
  return typeof forwardedProps?.model === "string" &&
      forwardedProps.model.trim().length > 0
    ? forwardedProps.model
    : undefined;
}

export function getForwardedHostedRuntimeOverrides(
  forwardedProps: Record<string, unknown> | undefined,
): ChatRuntimeOverrides | undefined {
  const runtimeOverrides = forwardedProps?.runtimeOverrides;
  if (!isRecord(runtimeOverrides)) {
    return undefined;
  }

  const parsedRuntimeOverrides = hostedChatRuntimeOverridesSchema.safeParse(
    runtimeOverrides,
  );
  if (!parsedRuntimeOverrides.success) {
    return undefined;
  }

  return Object.keys(parsedRuntimeOverrides.data).length > 0
    ? parsedRuntimeOverrides.data
    : undefined;
}

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
    requestedMaxSteps: effectiveRuntimeOverrides?.maxSteps ??
      input.agentConfig.maxSteps,
  };
}
