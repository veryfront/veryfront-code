/**
 * The `dev` banner check for agents whose default model this process cannot
 * serve with the provider keys it has.
 *
 * @module cli/commands/dev/default-model-check
 */

import { VeryfrontError } from "veryfront/errors";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { getAgentExecutionConfig } from "#veryfront/agent/runtime/execution-config.ts";
import { resolveRuntimeModel } from "#veryfront/agent/runtime/model-resolution.ts";
import { defaultModelKeyMismatchLine } from "../../shared/inference-setup.ts";
import { defaultModelMismatchKeys, type InferenceEnvironment } from "./inference-status.ts";

/** How the runtime resolves an agent's model, in this process by default. */
type ResolveModel = (model?: string) => string;

/**
 * Whether the runtime can resolve an agent with no model in this process. Only
 * `default-model-credential-mismatch` counts as no: the runtime raises it when
 * the default model's provider has no credential and another provider has one,
 * after Cloud routing and application providers are applied.
 */
export function defaultModelRunsHere(resolve: ResolveModel = resolveRuntimeModel): boolean {
  try {
    resolve(undefined);
    return true;
  } catch (error) {
    return !(error instanceof VeryfrontError && error.slug === "default-model-credential-mismatch");
  }
}

/** Whether `model: "auto"` resolves to direct inference here, not the gateway. */
export function autoRunsDirectHere(resolve: ResolveModel = resolveRuntimeModel): boolean {
  try {
    return !resolve("auto").startsWith("veryfront-cloud/");
  } catch {
    return false;
  }
}

/**
 * The model each registered agent sets, `undefined` for one that sets none.
 * Primitive discovery registers the project's agents before Ready. The
 * execution config keeps an omitted model omitted; the public config already
 * holds the default it resolves to.
 */
export function registeredAgentModels(): (string | undefined)[] {
  return [...agentRegistry.getAll().values()].map((agent) =>
    getAgentExecutionConfig(agent.config).model
  );
}

/** How this process resolves models, for {@link defaultModelMismatchWarning}. */
export interface DefaultModelRuntime {
  defaultModelRuns(): boolean;
  autoRunsDirect(): boolean;
}

const LIVE_RUNTIME: DefaultModelRuntime = {
  defaultModelRuns: () => defaultModelRunsHere(),
  autoRunsDirect: () => autoRunsDirectHere(),
};

/**
 * The banner warning for provider keys an agent with no model cannot use, or
 * `undefined` when every such agent's default model runs here.
 */
export function defaultModelMismatchWarning(
  environment: InferenceEnvironment,
  runtime: DefaultModelRuntime = LIVE_RUNTIME,
): string | undefined {
  const keys = defaultModelMismatchKeys(environment, runtime.defaultModelRuns());
  if (keys.length === 0) return undefined;
  return defaultModelKeyMismatchLine(keys, { autoRunsDirect: runtime.autoRunsDirect() });
}
