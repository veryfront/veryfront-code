import { cyan, green, yellow } from "../../platform/compat/console/index.js";

export function getDevTips(): string {
  return (
    `${yellow("Tips:")}\n` +
    `  • HMR is enabled by default - saves reload the browser\n` +
    `  • MCP server runs on port 9999 for coding agents (Claude Code, Cursor)\n` +
    `  • Press ${cyan("Ctrl+C")} to stop the server\n`
  );
}

export function getBuildTips(): string {
  return (
    `${yellow("Tips:")}\n` +
    `  • Run ${cyan("veryfront analyze-chunks")} after build to see bundle sizes\n` +
    `  • Use ${cyan("--dry-run")} to preview what will be generated\n` +
    `  • Deploy with ${cyan("veryfront serve")} or to any static host\n`
  );
}

export function getInitTemplates(): string {
  return (
    `${yellow("Available Templates:")}\n` +
    `  • ${green("ai")}       - AI agent with chat UI and tool calling (recommended)\n` +
    `  • ${green("app")}      - Full-stack app with auth & API\n` +
    `  • ${green("blog")}     - Blog with MDX, tags, and RSS\n` +
    `  • ${green("docs")}     - Documentation site with search\n` +
    `  • ${green("minimal")}  - Bare-bones starter\n`
  );
}

const COMMAND_TIPS: Record<string, () => string> = {
  dev: getDevTips,
  build: getBuildTips,
  init: getInitTemplates,
};

export function getCommandTips(command: string): string | undefined {
  return COMMAND_TIPS[command]?.();
}
