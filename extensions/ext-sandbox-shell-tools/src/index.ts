/**
 * ext-sandbox-shell-tools, SandboxShellToolsProvider backed by bash-tool.
 *
 * @module extensions/ext-sandbox-shell-tools
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type CreateSandboxShellToolsInput,
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "veryfront/extensions/sandbox";

type BashToolFactory = (
  input: CreateSandboxShellToolsInput,
) => Promise<{ tools: Record<string, unknown> }>;

export function createSandboxShellToolsProvider(
  createBashToolImpl: BashToolFactory,
): SandboxShellToolsProvider {
  return async (input) => await createBashToolImpl(input);
}

const provider = createSandboxShellToolsProvider(async (input) => {
  const { createBashTool } = await importBashTool();
  return await createBashTool(input);
});

async function importBashTool(): Promise<{ createBashTool: BashToolFactory }> {
  try {
    return await import("bash-tool") as { createBashTool: BashToolFactory };
  } catch (error) {
    if (!isMissingPackageError(error)) throw error;
    throw new Error(
      'Sandbox shell tools require the optional package "bash-tool". ' +
        "Install bash-tool@1.3.16 or pass createBashTool explicitly.",
    );
  }
}

function isMissingPackageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Module not found");
}

const extSandboxShellTools: ExtensionFactory = () => ({
  name: "ext-sandbox-shell-tools",
  version: "0.1.0",
  contracts: {
    provides: [SandboxShellToolsProviderName],
  },
  capabilities: [
    { type: "sandbox:execute", tools: ["bash"] },
  ],
  setup(ctx) {
    ctx.provide(SandboxShellToolsProviderName, provider);
    ctx.logger.info("[ext-sandbox-shell-tools] Sandbox shell tools provider registered");
  },
});

export default extSandboxShellTools;
export { provider as createBashSandboxShellToolsProvider };
