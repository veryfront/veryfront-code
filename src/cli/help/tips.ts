/**
 * Command-specific tips and additional help content
 * @module
 */

import { cyan, green, yellow } from "@veryfront/compat/console";

/**
 * Tips for the 'dev' command
 * @returns Formatted tips string
 */
export function getDevTips(): string {
  return (
    yellow("Tips:") +
    "\n" +
    `  • HMR is enabled by default - saves reload the browser\n` +
    `  • Press ${cyan("Ctrl+C")} to stop the server\n`
  );
}

/**
 * Tips for the 'build' command
 * @returns Formatted tips string
 */
export function getBuildTips(): string {
  return (
    yellow("Tips:") +
    "\n" +
    `  • Run ${cyan("veryfront analyze-chunks")} after build to see bundle sizes\n` +
    `  • Use ${cyan("--dry-run")} to preview what will be generated\n` +
    `  • Deploy with ${cyan("veryfront serve")} or to any static host\n`
  );
}

/**
 * Available templates for the 'init' command
 * @returns Formatted templates list
 */
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

/**
 * Gets command-specific tips based on command name
 * @param command - Command name
 * @returns Formatted tips string or undefined if no tips available
 */
export function getCommandTips(command: string): string | undefined {
  switch (command) {
    case "dev":
      return getDevTips();
    case "build":
      return getBuildTips();
    case "init":
      return getInitTemplates();
    default:
      return undefined;
  }
}
