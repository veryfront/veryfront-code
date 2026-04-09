import { cyan, dim, green, yellow } from "#cli/ui";

export function getDevTips(): string {
  return `${yellow("Tips:")}\n` +
    "  • HMR is enabled by default - saves reload the browser\n" +
    "  • MCP server runs on devPort + 2 (default 3002) for coding agents\n" +
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
    `  • ${green("ai-agent")}              - AI chatbot with tools and streaming\n` +
    `  • ${green("docs-agent")}         - Document Q&A with source citations\n` +
    `  • ${green("multi-agent-system")}  - Agents that delegate to each other\n` +
    `  • ${green("agentic-workflow")}    - AI pipeline with approvals\n` +
    `  • ${green("coding-agent")}        - AI code assistant with file tools\n` +
    `  • ${green("saas-starter")}        - AI SaaS with auth + per-user memory\n` +
    `  • ${green("minimal")}       - Blank canvas\n`;
}

export function getPostBuildTips(): string {
  return `\n  ${dim("Next steps:")}\n` +
    `    ${dim("•")} ${cyan("veryfront serve")}     Preview locally\n` +
    `    ${dim("•")} ${cyan("veryfront deploy")}    Deploy to production\n`;
}

export function getPostDeployTips(): string {
  return `\n  ${dim("Next steps:")}\n` +
    `    ${dim("•")} ${cyan("veryfront open")}      Open in browser\n`;
}

export function getPostInitTips(projectName: string): string {
  return `\n  ${dim("Next steps:")}\n` +
    `    ${dim("•")} cd ${cyan(projectName)}\n` +
    `    ${dim("•")} ${cyan("veryfront dev")}       Start development\n`;
}

const COMMAND_TIPS: Record<string, () => string> = {
  dev: getDevTips,
  build: getBuildTips,
  init: getInitTemplates,
};

export function getCommandTips(command: string): string | undefined {
  return COMMAND_TIPS[command]?.();
}
