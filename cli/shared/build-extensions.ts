/**
 * Extension composition for `veryfront build`.
 *
 * Extension orchestration used to happen only in server bootstrap, so commands
 * that never start a server ran with an almost empty contract registry. The
 * build path compensated with one-off shims (`ensureCliBundlerContracts`,
 * `ensureBuiltinContentProcessor`) that covered the contracts someone had
 * already been bitten by, and nothing else.
 *
 * CSS was the contract nobody had added a shim for. A scaffolded project whose
 * stylesheet is `@import "tailwindcss";` reached the release-asset CSS compile
 * with no CSSProcessor registered and failed with:
 *
 *   Missing extension for contract "CSSProcessor".
 *     Install it with: deno add @veryfront/ext-css-tailwind
 *
 * The extension was installed the whole time. `veryfront dev` compiled the same
 * stylesheet correctly because starting a server orchestrated it.
 *
 * Composing extensions here fixes that class of failure rather than one
 * instance of it, and honors what the project configures: a project that
 * declares `ext-css-lightning` gets its own processor instead of whichever one
 * a shim happened to hardcode. `veryfront eval` already does this.
 *
 * @module cli/shared/build-extensions
 */

import { orchestrateExtensions } from "veryfront/extensions";
import {
  createEvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "veryfront/extensions/eval";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "veryfront/extensions/llm";
import { cliLogger } from "#cli/utils";
import { createBuiltinExtensions } from "../../src/extensions/builtin-extensions.ts";

type OrchestrateExtensions = typeof orchestrateExtensions;
type OrchestrateOptions = Parameters<OrchestrateExtensions>[0];

/**
 * Compose the extensions a production build needs.
 *
 * `orchestrate` is a test seam and defaults to the real implementation.
 */
export async function setupBuildCliExtensions(
  projectDir: string,
  config: OrchestrateOptions["config"],
  orchestrate: OrchestrateExtensions = orchestrateExtensions,
): Promise<Awaited<ReturnType<OrchestrateExtensions>>> {
  return await orchestrate({
    projectDir,
    config,
    logger: cliLogger.component("build-extensions"),
    primeContracts: {
      [LLMProviderRegistryName]: createLLMProviderRegistry(),
      [EvalReportExporterRegistryName]: createEvalReportExporterRegistry(),
    },
    builtinExtensions: createBuiltinExtensions(),
  });
}
