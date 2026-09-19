/**
 * ext-sandbox-shell-tools, SandboxShellToolsProvider backed by bash-tool.
 *
 * @module extensions/ext-sandbox-shell-tools
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { FlexibleSchema } from "ai";
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
  const { asSchema } = await import("ai");
  const { createBashTool: createBashToolImpl } = await import("bash-tool");
  const result = await createBashToolImpl(input);
  const tools = Object.fromEntries(
    await Promise.all(
      Object.entries(result.tools).map(async ([name, tool]) => [name, {
        ...tool,
        inputSchemaJson: await asSchema(tool.inputSchema as FlexibleSchema<unknown>).jsonSchema,
      }]),
    ),
  );
  return { ...result, tools };
});

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
    ctx.logger.debug("[ext-sandbox-shell-tools] Sandbox shell tools provider registered");
  },
});

export default extSandboxShellTools;
export { provider as createBashSandboxShellToolsProvider };
