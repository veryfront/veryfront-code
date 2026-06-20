import { type AgentServiceConfigInput, parseAgentServiceConfig } from "../../service/config.ts";

/** Result returned from runtime confidence preflight. */
export interface RuntimeConfidencePreflightResult {
  ok: boolean;
  resolvedApiUrl: string;
  messages: string[];
}

/** Evaluate runtime confidence env helper. */
export function evaluateRuntimeConfidenceEnv(
  env: AgentServiceConfigInput = {},
  resolvedApiUrl: string = parseAgentServiceConfig(env).VERYFRONT_API_URL,
): RuntimeConfidencePreflightResult {
  const messages: string[] = [`Resolved VERYFRONT_API_URL: ${resolvedApiUrl}`];
  let hasBlockers = false;

  if (typeof env.VERYFRONT_TOKEN !== "string" || env.VERYFRONT_TOKEN.length === 0) {
    hasBlockers = true;
    messages.push("BLOCKER: VERYFRONT_TOKEN is missing");
  }
  if (typeof env.AG_UI_EVAL_PROJECT_ID !== "string" || env.AG_UI_EVAL_PROJECT_ID.length === 0) {
    hasBlockers = true;
    messages.push("BLOCKER: AG_UI_EVAL_PROJECT_ID is missing");
  }

  if (!hasBlockers) {
    messages.push("Runtime-confidence preflight: PASS");
    return { ok: true, resolvedApiUrl, messages };
  }

  messages.push("Runtime-confidence preflight: FAIL");
  return { ok: false, resolvedApiUrl, messages };
}

/** Print runtime confidence preflight helper. */
export function printRuntimeConfidencePreflight(
  result: RuntimeConfidencePreflightResult,
  output: Pick<Console, "error" | "log"> = console,
): void {
  for (const message of result.messages) {
    const writer = result.ok ? output.log : output.error;
    writer(message);
  }
}
