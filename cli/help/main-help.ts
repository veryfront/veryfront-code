import { COMMANDS } from "./command-definitions.ts";
import type { CommandCategory, CommandHelp } from "./types.ts";
import {
  calculateMaxLength,
  formatCommandList,
  formatCommandName,
  formatDescription,
  formatHeader,
  formatSectionHeader,
} from "./formatters.ts";
import { bold, dim } from "../ui/colors.ts";
import { DEFAULT_DEV_MCP_PORT } from "../shared/constants.ts";

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  development: "Development",
  deploy: "Deploy & Sync",
  project: "Project",
  files: "Files & Data",
  ai: "AI & Automation",
  auth: "Auth",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "development",
  "deploy",
  "project",
  "files",
  "ai",
  "auth",
];

function groupByCategory(commands: CommandHelp[]): Map<CommandCategory, CommandHelp[]> {
  const groups = new Map<CommandCategory, CommandHelp[]>();
  for (const cmd of commands) {
    const group = groups.get(cmd.category) ?? [];
    group.push(cmd);
    groups.set(cmd.category, group);
  }
  return groups;
}

export function showMainHelp(): void {
  console.log(formatHeader());
  console.log();
  console.log(`  ${bold("Usage:")} veryfront <command> [options]`);
  console.log();

  const commands = Object.values(COMMANDS);
  const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  const grouped = groupByCategory(commands);

  for (const category of CATEGORY_ORDER) {
    const cmds = grouped.get(category);
    if (!cmds || cmds.length === 0) continue;

    console.log(`  ${formatSectionHeader(CATEGORY_LABELS[category])}`);
    for (const line of formatCommandList(cmds, maxLength)) {
      console.log(line);
    }
    console.log();
  }

  console.log(`  ${formatSectionHeader("Global Options")}`);
  console.log(
    `    ${formatCommandName("-h, --help", maxLength)} ${formatDescription("Show help")}`,
  );
  console.log(
    `    ${formatCommandName("-v, --version", maxLength)} ${formatDescription("Show version")}`,
  );
  console.log(
    `    ${formatCommandName("--json", maxLength)} ${formatDescription("Output as JSON")}`,
  );
  console.log(
    `    ${formatCommandName("--yes", maxLength)} ${
      formatDescription("Skip confirmation prompts")
    }`,
  );

  console.log();
  console.log(`  ${formatSectionHeader("Quick Start")}`);
  console.log(`    ${dim("$")} veryfront init my-app`);
  console.log(`    ${dim("$")} cd my-app`);
  console.log(`    ${dim("$")} veryfront dev`);

  console.log();
  console.log(`  ${formatSectionHeader("Coding Agents (MCP)")}`);
  console.log(`    ${dim("HTTP:")}   MCP auto-starts with dev server (default port ${DEFAULT_DEV_MCP_PORT})`);
  console.log(`    ${dim("stdio:")}  veryfront mcp`);
  console.log(`    ${dim("Schema:")} veryfront schema --json`);

  console.log();
  console.log(`  ${formatSectionHeader("Learn More")}`);
  console.log(`    ${dim("Docs:")}  https://github.com/veryfront/veryfront`);
  console.log(`    ${dim("Tips:")}  veryfront <command> --help`);
  console.log();
}
