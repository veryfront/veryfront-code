import {
  type AgentServiceConfigInput,
  parseAgentServiceConfig,
} from "../../../agent/service/config.ts";
import { assertEvalTimerDuration } from "../../validation.ts";

/** Public API contract for durable run canary environment. */
export interface DurableRunCanaryEnvironment {
  apiUrl: string;
  authToken: string;
  projectId: string;
  model: string | undefined;
  requestTimeoutMs: number;
  keepSuccessfulEvidence: boolean;
}

/** Default value for durable run canary timeout ms. */
export const DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS = 240_000;

function readTrimmedEnvironmentString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolves durable run canary environment. */
export function resolveDurableRunCanaryEnvironment(
  env: AgentServiceConfigInput = {},
): DurableRunCanaryEnvironment {
  const requestTimeoutMs = Number(
    env.DURABLE_CANARY_TIMEOUT_MS ?? DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS,
  );
  assertEvalTimerDuration(requestTimeoutMs, "DURABLE_CANARY_TIMEOUT_MS", { min: 1 });
  const explicitApiUrl = readTrimmedEnvironmentString(env.VERYFRONT_API_URL);

  return {
    apiUrl: explicitApiUrl ??
      parseAgentServiceConfig({
        ...env,
        VERYFRONT_API_URL: undefined,
      }).VERYFRONT_API_URL,
    authToken: readTrimmedEnvironmentString(env.VERYFRONT_TOKEN) ?? "",
    projectId: readTrimmedEnvironmentString(env.AG_UI_EVAL_PROJECT_ID) ?? "",
    model: readTrimmedEnvironmentString(env.AG_UI_EVAL_MODEL),
    requestTimeoutMs,
    keepSuccessfulEvidence: env.DURABLE_CANARY_KEEP_SUCCESS === "1",
  };
}
