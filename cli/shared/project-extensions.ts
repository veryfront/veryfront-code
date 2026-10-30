/**
 * Extension startup for one-shot commands that run project code.
 *
 * `dev` and `serve` start the extensions a project declares through server
 * bootstrap, which also wires the tracing shim. `task` and `eval` run project
 * code without a server, so they start the extensions here. Without the shim
 * wiring, a declared OpenTelemetry extension starts but receives no spans.
 *
 * @module cli/shared/project-extensions
 */

import { type ExtensionLoader, orchestrateExtensions } from "veryfront/extensions";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { cliLogger } from "#cli/utils";
import { wireTracingShim } from "../../src/server/tracing-shim.ts";
import { isJsonMode } from "./json-output.ts";

const telemetryDisposals = new WeakMap<ExtensionLoader, () => boolean>();

/** Start the default local runtime for task and workflow execution. */
export async function setupDefaultProjectCliExtensions(
  options: Pick<Parameters<typeof orchestrateExtensions>[0], "projectDir" | "config" | "logger">,
): Promise<ExtensionLoader> {
  const { createBuiltinExtensions } = await import("../../src/extensions/builtin-extensions.ts");
  const { createLLMProviderRegistry, LLMProviderRegistryName } = await import(
    "veryfront/extensions/llm"
  );
  const { createEvalReportExporterRegistry, EvalReportExporterRegistryName } = await import(
    "veryfront/extensions/eval"
  );
  return await setupProjectCliExtensions({
    ...options,
    setupTimeoutMs: getEnvironmentConfig().extensionSetupTimeoutMs,
    primeContracts: {
      [LLMProviderRegistryName]: createLLMProviderRegistry(),
      [EvalReportExporterRegistryName]: createEvalReportExporterRegistry(),
    },
    builtinExtensions: createBuiltinExtensions(),
  });
}

/**
 * Start the project's extensions and wire tracing into the core shim.
 *
 * Release the returned loader with {@link releaseProjectCliExtensions} before
 * the process exits: extension teardown flushes pending spans.
 */
export async function setupProjectCliExtensions(
  options: Parameters<typeof orchestrateExtensions>[0],
): Promise<ExtensionLoader> {
  const loader = await orchestrateExtensions({
    ...options,
    setupTimeoutMs: options.setupTimeoutMs ?? getEnvironmentConfig().extensionSetupTimeoutMs,
  });
  try {
    telemetryDisposals.set(loader, wireTracingShim());
  } catch (error) {
    // The caller has not received the loader yet, so startup owns cleanup.
    // Preserve the wiring failure even if extension teardown fails too.
    await releaseProjectCliExtensions(loader);
    throw error;
  }
  return loader;
}

/**
 * Tear down project extensions without replacing the command's outcome.
 *
 * Teardown flushes telemetry, so an unreachable or rejecting collector makes it
 * fail. That must not turn a passing task or eval into a failed one.
 */
export async function releaseProjectCliExtensions(loader: ExtensionLoader): Promise<void> {
  try {
    await loader.teardownAll();
  } catch {
    if (!isJsonMode()) {
      cliLogger.warn("Extension teardown failed; some telemetry may not have been exported");
    }
  } finally {
    const dispose = telemetryDisposals.get(loader);
    telemetryDisposals.delete(loader);
    dispose?.();
  }
}
