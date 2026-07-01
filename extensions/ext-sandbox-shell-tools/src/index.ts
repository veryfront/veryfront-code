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

type BashToolModule = {
  createBashTool: BashToolFactory;
};

type BashToolModuleLoader = () => Promise<BashToolModule>;

export function createSandboxShellToolsProvider(
  createBashToolImpl: BashToolFactory,
): SandboxShellToolsProvider {
  return async (input) => await createBashToolImpl(input);
}

async function loadDefaultBashToolModule(): Promise<BashToolModule> {
  const { createBashTool: createBashToolImpl } = await import("bash-tool");
  return { createBashTool: createBashToolImpl as BashToolFactory };
}

function isMissingOptionalPackageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return code === "ERR_MODULE_NOT_FOUND" ||
    message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("Module not found");
}

function createMissingSandboxShellDependencyError(cause: unknown): Error {
  const error = new Error(
    'Sandbox shell tools require optional peer dependencies "bash-tool" and "just-bash". Install them in the application package or pass createBashTool explicitly.',
  );
  (error as { cause?: unknown }).cause = cause;
  return error;
}

export function createLazyBashSandboxShellToolsProvider(
  loadBashToolModule: BashToolModuleLoader = loadDefaultBashToolModule,
): SandboxShellToolsProvider {
  return createSandboxShellToolsProvider(async (input) => {
    let bashToolModule: BashToolModule;
    try {
      bashToolModule = await loadBashToolModule();
    } catch (error) {
      if (isMissingOptionalPackageError(error)) {
        throw createMissingSandboxShellDependencyError(error);
      }
      throw error;
    }
    return await bashToolModule.createBashTool(input);
  });
}

const provider = createLazyBashSandboxShellToolsProvider();

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
