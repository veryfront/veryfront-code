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

/** Resolves live eval environment. */
export function resolveLiveEvalEnvironment(
  env: AgentServiceConfigInput = {},
): LiveEvalEnvironment {
  return {
    endpoint: typeof env.AG_UI_EVAL_ENDPOINT === "string"
      ? env.AG_UI_EVAL_ENDPOINT
      : DEFAULT_LIVE_EVAL_ENDPOINT,
    authToken: typeof env.VERYFRONT_TOKEN === "string" ? env.VERYFRONT_TOKEN : "",
    apiUrl: typeof env.VERYFRONT_API_URL === "string"
      ? env.VERYFRONT_API_URL
      : parseAgentServiceConfig(env).VERYFRONT_API_URL,
    projectId: typeof env.AG_UI_EVAL_PROJECT_ID === "string"
      ? env.AG_UI_EVAL_PROJECT_ID
      : undefined,
    branchId: typeof env.AG_UI_EVAL_BRANCH_ID === "string" ? env.AG_UI_EVAL_BRANCH_ID : undefined,
    model: typeof env.AG_UI_EVAL_MODEL === "string" ? env.AG_UI_EVAL_MODEL : undefined,
  };
}
