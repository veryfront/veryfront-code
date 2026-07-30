# @veryfront/ext-claude-code-agent

> **Category:** Workflow agent runtime | **Contract:**
> `ClaudeCodeAgentRuntime` | **Activation:** explicit

Runs Veryfront's Claude Code workflow tools through Anthropic's Claude Agent
SDK. The SDK and its transitive dependencies live in this extension; Veryfront
core only owns the provider-neutral runtime contract.

```ts
import extClaudeCodeAgent from "@veryfront/ext-claude-code-agent";

export default {
  extensions: [extClaudeCodeAgent()],
};
```

Omitting the extension makes `executeAgent()` fail with an actionable missing
contract error. Agent requests default to read-only `analysis` mode. File edits
require explicit `mode: "code"`; unrestricted `bypassPermissions` additionally
requires a server-controlled `AgentConfig` opt-in.

The extension can read and write the configured workspace, spawn Claude Code,
read its environment, and make outbound network requests. Treat activation as
a privileged deployment decision.
