/**
 * Main help screen display
 * @module
 */

import { cyan, dim, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import { COMMANDS } from "./command-definitions.ts";
import {
  calculateMaxLength,
  formatCommandList,
  formatCommandName,
  formatDescription,
  formatHeader,
  formatSectionHeader,
} from "./formatters.ts";

/**
 * Displays the main help screen with all available commands
 */
export function showMainHelp(): void {
  cliLogger.info(formatHeader());
  cliLogger.info("A Deno-first React framework with RSC support\n");

  cliLogger.info(`${yellow("Usage:")} veryfront <command> [options]\n`);

  // Display commands list
  cliLogger.info(formatSectionHeader("Commands"));
  const commands = Object.values(COMMANDS);
  const formattedCommands = formatCommandList(commands);
  for (const line of formattedCommands) {
    cliLogger.info(line);
  }

  // Display global options
  const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  cliLogger.info(
    `\n${formatSectionHeader("Global Options")}\n` +
      `  ${formatCommandName("-h, --help", maxLength)} ${formatDescription("Show help")}\n` +
      `  ${formatCommandName("-v, --version", maxLength)} ${formatDescription("Show version")}\n`,
  );

  // Display quick start guide
  cliLogger.info(
    `\n${formatSectionHeader("Quick Start")}\n` +
      `  ${dim("$")} ${cyan("veryfront init my-app")}\n` +
      `  ${dim("$")} ${cyan("cd my-app")}\n` +
      `  ${dim("$")} ${cyan("veryfront dev")}\n`,
  );

  // Display learning resources
  cliLogger.info(
    `\n${formatSectionHeader("Learn More")}\n` +
      `  ${dim("Docs:")}  https://github.com/veryfront/veryfront\n` +
      `  ${dim("Tips:")}  veryfront <command> --help\n`,
  );
}
