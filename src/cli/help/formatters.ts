/**
 * Help text formatting utilities
 * @module
 */

import { bold, cyan, dim, green, yellow } from "@veryfront/compat/console";
import { VERSION } from "@veryfront/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { getColorEnabled } from "../utils/index.ts";

/**
 * Conditionally apply color function based on NO_COLOR and TTY
 */
function c<T extends (s: string) => string>(colorFn: T, text: string): string {
  return getColorEnabled() ? colorFn(text) : text;
}

/**
 * Formats the main application header
 * @returns Formatted header string
 */
export function formatHeader(): string {
  return c(bold, c(cyan, "\n⚡ Veryfront")) + c(dim, ` v${VERSION}\n`);
}

/**
 * Formats a command name for display
 * @param name - Command name
 * @param paddingLength - Total length to pad to
 * @returns Formatted command name
 */
export function formatCommandName(name: string, paddingLength: number): string {
  return c(green, name.padEnd(paddingLength + 2));
}

/**
 * Formats a command description
 * @param description - Description text
 * @returns Formatted description
 */
export function formatDescription(description: string): string {
  return c(dim, description);
}

/**
 * Formats a usage pattern
 * @param usage - Usage pattern string
 * @returns Formatted usage string
 */
export function formatUsage(usage: string): string {
  return `${c(yellow, "Usage:")} ${usage}\n`;
}

/**
 * Formats an option flag
 * @param flag - Option flag string
 * @param paddingLength - Total length to pad to
 * @returns Formatted option flag
 */
export function formatOptionFlag(flag: string, paddingLength: number): string {
  return c(green, flag.padEnd(paddingLength + 2));
}

/**
 * Formats an option with its default value
 * @param option - Option configuration
 * @param paddingLength - Total length to pad flag to
 * @returns Formatted option line
 */
export function formatOption(option: CommandOption, paddingLength: number): string {
  const defaultStr = option.default ? c(dim, ` (default: ${option.default})`) : "";
  return `  ${formatOptionFlag(option.flag, paddingLength)} ${option.description}${defaultStr}`;
}

/**
 * Formats an example command
 * @param example - Example command string
 * @returns Formatted example
 */
export function formatExample(example: string): string {
  return `  ${c(dim, "$")} ${c(cyan, example)}`;
}

/**
 * Formats a section header
 * @param title - Section title
 * @returns Formatted section header
 */
export function formatSectionHeader(title: string): string {
  return c(yellow, title + ":");
}

/**
 * Formats a command header with name
 * @param commandName - Name of the command
 * @returns Formatted command header
 */
export function formatCommandHeader(commandName: string): string {
  return `${c(bold, c(cyan, `\n⚡ Veryfront ${commandName}`))}\n`;
}

/**
 * Formats the ASCII logo
 * @returns Formatted logo string
 */
export function formatAsciiLogo(): string {
  return `
${c(cyan, "╔══════════════════════════════════════╗")}
${c(cyan, "║")}  ⚡  ${c(bold, "VERYFRONT")}                      ${c(cyan, "║")}
${c(cyan, "║")}  ${c(dim, "Deno-First React Framework")}        ${c(cyan, "║")}
${c(cyan, "╚══════════════════════════════════════╝")}
`;
}

/**
 * Calculates the maximum length from a list of strings
 * @param items - Array of items with length property
 * @returns Maximum length
 */
export function calculateMaxLength(items: Array<{ length: number }>): number {
  return Math.max(...items.map((item) => item.length));
}

/**
 * Formats a list of commands with descriptions
 * @param commands - Array of command help objects
 * @returns Array of formatted command lines
 */
export function formatCommandList(commands: CommandHelp[]): string[] {
  const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  return commands.map((cmd) =>
    `  ${formatCommandName(cmd.name, maxLength)} ${formatDescription(cmd.description)}`
  );
}
