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
import { createBashTool } from "bash-tool";

type BashToolFactory = (
  input: CreateSandboxShellToolsInput,
) => Promise<{ tools: Record<string, unknown> }>;

export function createSandboxShellToolsProvider(
  createBashToolImpl: BashToolFactory,
): SandboxShellToolsProvider {
  return async (input) => await createBashToolImpl(input);
}

const provider = createSandboxShellToolsProvider(createBashTool);

const extSandboxShellTools: ExtensionFactory = () => ({
  name: "ext-sandbox-shell-tools",
  version: "0.1.0",
  contracts: {
    provides: [SandboxShellToolsProviderName],
  },
  capabilities: [],
  setup(ctx) {
    ctx.provide(SandboxShellToolsProviderName, provider);
    ctx.logger.info("[ext-sandbox-shell-tools] Sandbox shell tools provider registered");
  },
});

export default extSandboxShellTools;
export { provider as createBashSandboxShellToolsProvider };
