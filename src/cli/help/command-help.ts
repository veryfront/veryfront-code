/**
 * Individual command help display
 * @module
 */

import { cliLogger } from "@veryfront/utils";
import { COMMANDS } from "./command-definitions.ts";
import {
  calculateMaxLength,
  formatCommandHeader,
  formatExample,
  formatOption,
  formatSectionHeader,
  formatUsage,
} from "./formatters.ts";
import { getCommandTips } from "./tips.ts";
import { showMainHelp } from "./main-help.ts";

/**
 * Displays detailed help for a specific command
 * @param command - Command name to show help for
 */
export function showCommandHelp(command: string): void {
  const cmd = COMMANDS[command];
  if (!cmd) {
    cliLogger.error(`Unknown command: ${command}`);
    showMainHelp();
    return;
  }

  // Header
  cliLogger.info(formatCommandHeader(cmd.name));
  cliLogger.info(`${cmd.description}\n`);

  // Usage
  cliLogger.info(formatUsage(cmd.usage));

  // Options
  if (cmd.options && cmd.options.length > 0) {
    cliLogger.info(formatSectionHeader("Options"));
    const maxLength = calculateMaxLength(cmd.options.map((o) => ({ length: o.flag.length })));

    for (const opt of cmd.options) {
      cliLogger.info(formatOption(opt, maxLength));
    }
    cliLogger.info("");
  }

  // Examples
  if (cmd.examples && cmd.examples.length > 0) {
    cliLogger.info(formatSectionHeader("Examples"));
    for (const example of cmd.examples) {
      cliLogger.info(formatExample(example));
    }
    cliLogger.info("");
  }

  // Command-specific tips
  const tips = getCommandTips(command);
  if (tips) {
    cliLogger.info(tips);
  }
}
