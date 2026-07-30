/**
 * `@veryfront/ext-claude-code-agent` — Anthropic Claude Agent SDK runtime.
 *
 * @module extensions/ext-claude-code-agent
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { ClaudeCodeAgentRuntimeName } from "veryfront/workflow/claude-code/runtime";
import { AnthropicClaudeCodeAgentRuntime } from "./runtime.ts";

const extClaudeCodeAgent: ExtensionFactory = (config?: unknown) => {
  if (config !== undefined) {
    throw new TypeError("ext-claude-code-agent does not accept extension configuration");
  }
  let active = false;

  return {
    name: "ext-claude-code-agent",
    version: "0.1.0",
    contracts: {
      provides: [ClaudeCodeAgentRuntimeName],
    },
    capabilities: [
      { type: "fs:read" },
      { type: "fs:write" },
      { type: "env:read" },
      { type: "net:outbound", hosts: ["*"] },
      { type: "process:spawn" },
    ],
    setup(ctx) {
      if (active) throw new Error("ext-claude-code-agent is already set up");
      ctx.signal?.throwIfAborted();
      const runtime = new AnthropicClaudeCodeAgentRuntime({ logger: ctx.logger });
      ctx.provide(ClaudeCodeAgentRuntimeName, runtime);
      active = true;
      try {
        ctx.logger.debug("[ext-claude-code-agent] runtime registered");
      } catch {
        // Diagnostics must not invalidate a registered runtime.
      }
    },
    teardown() {
      active = false;
    },
  };
};

export default extClaudeCodeAgent;
export {
  AnthropicClaudeCodeAgentRuntime,
  type AnthropicClaudeCodeAgentRuntimeDependencies,
  type ClaudeAgentQuery,
  resolvePermissionMode,
} from "./runtime.ts";
