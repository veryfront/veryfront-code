import { cyan, green, yellow } from "#cli/ui";

export function getDevTips(): string {
  return `${yellow("Tips:")}\n` +
    "  • HMR is enabled by default - saves reload the browser\n" +
    "  • MCP server runs on port 9999 for coding agents (Claude Code, Cursor)\n" +
    `  • Press ${cyan("Ctrl+C")} to stop the server\n`;
}

export function getBuildTips(): string {
  return `${yellow("Tips:")}\n` +
    `  • Run ${cyan("veryfront analyze-chunks")} after build to see bundle sizes\n` +
    `  • Use ${cyan("--dry-run")} to preview what will be generated\n` +
    `  • Deploy with ${cyan("veryfront serve")} or to any static host\n`;
}

export function getInitTemplates(): string {
  return `${yellow("Available Templates:")}\n` +
    `  • ${green("ai-assistant")}         - AI chatbot with tools and streaming\n` +
    `  • ${green("chat-with-your-docs")} - Chat with your docs (RAG + citations)\n` +
    `  • ${green("multi-agent-system")}  - Agents that delegate to each other\n` +
    `  • ${green("agentic-workflow")}    - AI pipeline with approvals\n` +
    `  • ${green("coding-agent")}        - AI code assistant with file tools\n` +
    `  • ${green("saas-starter")}        - AI SaaS with auth + per-user memory\n` +
    `  • ${green("minimal")}       - Blank canvas\n`;
}

const COMMAND_TIPS: Record<string, () => string> = {
  dev: getDevTips,
  build: getBuildTips,
  init: getInitTemplates,
};

export function getCommandTips(command: string): string | undefined {
  return COMMAND_TIPS[command]?.();
}
