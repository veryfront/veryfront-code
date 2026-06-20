import {
  type AgentServiceConfigInput,
  parseAgentServiceConfig,
} from "../../../agent/service/config.ts";

/** Public API contract for durable run canary environment. */
export interface DurableRunCanaryEnvironment {
  apiUrl: string;
  authToken: string;
  projectId: string;
  requestTimeoutMs: number;
  keepSuccessfulEvidence: boolean;
}

/** Default value for durable run canary timeout ms. */
export const DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS = 240_000;

/** Resolves durable run canary environment. */
export function resolveDurableRunCanaryEnvironment(
  env: AgentServiceConfigInput = {},
): DurableRunCanaryEnvironment {
  return {
    apiUrl: typeof env.VERYFRONT_API_URL === "string"
      ? env.VERYFRONT_API_URL
      : parseAgentServiceConfig(env).VERYFRONT_API_URL,
    authToken: typeof env.VERYFRONT_TOKEN === "string" ? env.VERYFRONT_TOKEN : "",
    projectId: typeof env.AG_UI_EVAL_PROJECT_ID === "string" ? env.AG_UI_EVAL_PROJECT_ID : "",
    requestTimeoutMs: Number(
      env.DURABLE_CANARY_TIMEOUT_MS ?? DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS,
    ),
    keepSuccessfulEvidence: env.DURABLE_CANARY_KEEP_SUCCESS === "1",
  };
}
