import {
  type AgentServiceConfigInput,
  parseAgentServiceConfig,
} from "../../../agent/service/config.ts";

/** Public API contract for live eval environment. */
export interface LiveEvalEnvironment {
  endpoint: string;
  authToken: string;
  apiUrl: string;
  projectId: string | undefined;
  branchId: string | undefined;
  model: string | undefined;
}

/** Default value for live eval endpoint. */
export const DEFAULT_LIVE_EVAL_ENDPOINT = "http://127.0.0.1:3001/api/ag-ui";

function readTrimmedEnvironmentString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolves live eval environment. */
export function resolveLiveEvalEnvironment(
  env: AgentServiceConfigInput = {},
): LiveEvalEnvironment {
  const explicitApiUrl = readTrimmedEnvironmentString(env.VERYFRONT_API_URL);
  return {
    endpoint: readTrimmedEnvironmentString(env.AG_UI_EVAL_ENDPOINT) ??
      DEFAULT_LIVE_EVAL_ENDPOINT,
    authToken: readTrimmedEnvironmentString(env.VERYFRONT_TOKEN) ?? "",
    apiUrl: explicitApiUrl ??
      parseAgentServiceConfig({
        ...env,
        VERYFRONT_API_URL: undefined,
      }).VERYFRONT_API_URL,
    projectId: readTrimmedEnvironmentString(env.AG_UI_EVAL_PROJECT_ID),
    branchId: readTrimmedEnvironmentString(env.AG_UI_EVAL_BRANCH_ID),
    model: readTrimmedEnvironmentString(env.AG_UI_EVAL_MODEL),
  };
}
