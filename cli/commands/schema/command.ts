/**
 * Schema introspection command
 *
 * Generates a machine-readable description of all CLI commands,
 * their arguments, flags, and output schemas.
 * Single source of truth: derived from COMMANDS registry and help definitions.
 *
 * @module cli/commands/schema
 */

import { COMMANDS } from "../../help/command-definitions.ts";
import type { CommandCategory, CommandHelp } from "../../help/types.ts";
import { VERSION } from "#cli/utils";

export interface CommandSchema {
  name: string;
  category: string;
  description: string;
  usage: string;
  options: Array<{
    flag: string;
    description: string;
    default?: string;
  }>;
  flags: string[];
  examples: string[];
}

export interface FullSchema {
  version: string;
  commands: CommandSchema[];
}

function commandToSchema(help: CommandHelp): CommandSchema {
  const globalFlags = ["--json", "--quiet", "--verbose", "--yes", "--help"];

  return {
    name: help.name,
    category: help.category,
    description: help.description,
    usage: help.usage,
    options: (help.options ?? []).map((o) => ({
      flag: o.flag,
      description: o.description,
      ...(o.default ? { default: o.default } : {}),
    })),
    flags: globalFlags,
    examples: help.examples ?? [],
  };
}

export function generateSchema(category?: CommandCategory): FullSchema {
  const commands = Object.values(COMMANDS)
    .filter((cmd) => !category || cmd.category === category)
    .map(commandToSchema);

  return { version: VERSION, commands };
}

export function generateCommandSchema(name: string): CommandSchema | null {
  const help = COMMANDS[name];
  if (!help) return null;
  return commandToSchema(help);
}
