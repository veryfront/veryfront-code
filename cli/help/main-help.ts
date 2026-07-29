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

export function showMainHelp(showAll = false): void {
  console.log(formatHeader());
  console.log();
  console.log(`  ${bold("Usage:")} veryfront <command> [options]`);
  console.log();

  const allCommands = Object.values(COMMANDS);
  const commands = showAll ? allCommands : allCommands.filter((c) => !c.hidden);
  const maxLength = calculateMaxLength(
    commands.map((c) => {
      const display = c.aliases && c.aliases.length > 0
        ? `${c.name} (${c.aliases.join(", ")})`
        : c.name;
      return { length: display.length };
    }),
  );
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
    `    ${formatCommandName("-q, --quiet", maxLength)} ${formatDescription("Suppress output")}`,
  );
  console.log(
    `    ${formatCommandName("--verbose", maxLength)} ${
      formatDescription("Show diagnostic detail")
    }`,
  );
  console.log(
    `    ${formatCommandName("--yes", maxLength)} ${
      formatDescription("Skip confirmation prompts")
    }`,
  );
  console.log(
    `    ${formatCommandName("--no-input", maxLength)} ${
      formatDescription("Disable interactive prompts")
    }`,
  );
  console.log(
    `    ${formatCommandName("--no-color", maxLength)} ${formatDescription("Disable color")}`,
  );
  console.log(
    `    ${formatCommandName("--no-animation", maxLength)} ${
      formatDescription("Disable animation")
    }`,
  );

  console.log();
  console.log(`  ${formatSectionHeader("Quick Start")}`);
  console.log(`    ${dim("$")} veryfront init my-app`);
  console.log(`    ${dim("$")} cd my-app`);
  console.log(`    ${dim("$")} veryfront dev`);

  console.log();
  console.log(`  ${formatSectionHeader("Preview & Deploy")}`);
  console.log(`    ${dim("$")} veryfront push`);
  console.log(`    ${dim("$")} veryfront deploy`);

  console.log();
  console.log(`  ${formatSectionHeader("Coding Agents (MCP)")}`);
  console.log(
    `    ${dim("HTTP:")}   MCP auto-starts with dev server (default port ${DEFAULT_DEV_MCP_PORT})`,
  );
  console.log(`    ${dim("stdio:")}  veryfront mcp`);
  console.log(`    ${dim("Schema:")} veryfront schema --json`);

  console.log();
  console.log(`  ${formatSectionHeader("Learn More")}`);
  console.log(`    ${dim("Docs:")}    https://veryfront.com/docs`);
  console.log(`    ${dim("Support:")} https://github.com/veryfront/veryfront-code/issues`);
  console.log(`    ${dim("Help:")}    veryfront <command> --help`);
  console.log();

  if (!showAll && allCommands.some((c) => c.hidden)) {
    console.log(`  ${dim("Run veryfront help --all to include internal commands")}`);
    console.log();
  }
}
