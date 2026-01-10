import { cyan, green, yellow } from "@veryfront/compat/console";

export function getDevTips(): string {
  return (
    yellow("Tips:") +
    "\n" +
    `  • HMR is enabled by default - saves reload the browser\n` +
    `  • Press ${cyan("Ctrl+C")} to stop the server\n`
  );
}

export function getBuildTips(): string {
  return (
    yellow("Tips:") +
    "\n" +
    `  • Run ${cyan("veryfront analyze-chunks")} after build to see bundle sizes\n` +
    `  • Use ${cyan("--dry-run")} to preview what will be generated\n` +
    `  • Deploy with ${cyan("veryfront serve")} or to any static host\n`
  );
}

export function getInitTemplates(): string {
  return (
    yellow("Available Templates:") +
    "\n" +
    `  • ${green("blog")}     - Blog with MDX, tags, and RSS\n` +
    `  • ${green("docs")}     - Documentation site with search\n` +
    `  • ${green("app")}      - Full-stack app with auth & API\n` +
    `  • ${green("minimal")}  - Bare-bones starter\n`
  );
}

const COMMAND_TIPS: Record<string, () => string> = {
  dev: getDevTips,
  build: getBuildTips,
  init: getInitTemplates,
} as const;

export function getCommandTips(command: string): string | undefined {
  return COMMAND_TIPS[command]?.();
}
