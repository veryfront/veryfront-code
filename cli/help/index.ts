import { COMMANDS } from "./command-definitions.ts";
import { COMMAND_CATEGORIES, type CommandCategory, type CommandHelp } from "./types.ts";

export { showMainHelp } from "./main-help.ts";
export { showCommandHelp } from "./command-help.ts";
export { COMMANDS } from "./command-definitions.ts";
export { COMMAND_CATEGORIES } from "./types.ts";

export type { CommandCategory, CommandHelp, CommandOption, CommandRegistry } from "./types.ts";

function resolveCommandHelpName(command: string): string {
  if (Object.hasOwn(COMMANDS, command)) return command;

  for (const help of Object.values(COMMANDS)) {
    if ((help.aliases ?? []).includes(command)) return help.name;
  }

  return command;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  development: "Development",
  deploy: "Deploy & Sync",
  project: "Project",
  files: "Files & Data",
  ai: "AI & Automation",
  auth: "Auth",
};

export interface StructuredCommandHelp
  extends Omit<CommandHelp, "options" | "examples" | "notes" | "aliases"> {
  options: NonNullable<CommandHelp["options"]>;
  examples: string[];
  notes: string[];
  aliases: string[];
}

export interface StructuredMainHelp {
  usage: string;
  showAll: boolean;
  categories: Array<{ value: CommandCategory; label: string }>;
  commands: StructuredCommandHelp[];
  globalOptions: Array<{ flag: string; description: string }>;
  quickStart: string[];
  previewDeploy: string[];
  codingAgents: Array<{ label: string; description: string }>;
}

function toStructuredCommandHelp(command: CommandHelp): StructuredCommandHelp {
  return {
    name: command.name,
    category: command.category,
    description: command.description,
    usage: command.usage,
    options: command.options ?? [],
    examples: command.examples ?? [],
    notes: command.notes ?? [],
    aliases: command.aliases ?? [],
    ...(command.hidden === true ? { hidden: true } : {}),
  };
}

export function getStructuredCommandHelp(command: string): StructuredCommandHelp | null {
  const resolved = resolveCommandHelpName(command);
  if (!Object.hasOwn(COMMANDS, resolved)) return null;

  const help = COMMANDS[resolved];
  return help ? toStructuredCommandHelp(help) : null;
}

export function getStructuredMainHelp(showAll = false): StructuredMainHelp {
  const allCommands = Object.values(COMMANDS);
  const visibleCommands = showAll ? allCommands : allCommands.filter((command) => !command.hidden);

  return {
    usage: "veryfront <command> [options]",
    showAll,
    categories: COMMAND_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
    commands: visibleCommands.map(toStructuredCommandHelp),
    globalOptions: [
      { flag: "-h, --help", description: "Show help" },
      { flag: "-v, --version", description: "Show version" },
      { flag: "--json", description: "Output as JSON" },
      { flag: "-q, --quiet", description: "Suppress output" },
      { flag: "--verbose", description: "Show diagnostic detail" },
      { flag: "--yes", description: "Skip confirmation prompts" },
      { flag: "--no-input", description: "Disable interactive prompts" },
      { flag: "--no-color", description: "Disable color" },
      { flag: "--no-animation", description: "Disable animation" },
    ],
    quickStart: ["veryfront init my-app", "cd my-app", "veryfront dev"],
    previewDeploy: ["veryfront push", "veryfront deploy"],
    codingAgents: [
      { label: "HTTP", description: "MCP auto-starts with dev server" },
      { label: "stdio", description: "veryfront mcp" },
      { label: "Schema", description: "veryfront schema --json" },
    ],
  };
}
