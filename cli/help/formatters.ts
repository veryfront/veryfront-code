import { VERSION } from "#cli/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { bold, brand, dim, muted } from "../ui/colors.ts";

export function formatHeader(): string {
  return `${bold("Veryfront")} ${dim(`(v${VERSION})`)}`;
}

export function formatCommandName(name: string, paddingLength: number): string {
  return brand(name.padEnd(paddingLength + 2));
}

export function formatDescription(description: string): string {
  return muted(description);
}

export function formatUsage(usage: string): string {
  return `  ${bold("Usage:")} ${usage}`;
}

export function formatOptionFlag(flag: string, paddingLength: number): string {
  return flag.padEnd(paddingLength + 2);
}

export function formatOption(option: CommandOption, paddingLength: number): string {
  const defaultStr = option.default ? dim(` (default: ${option.default})`) : "";
  return `    ${formatOptionFlag(option.flag, paddingLength)} ${
    muted(option.description)
  }${defaultStr}`;
}

export function formatExample(example: string): string {
  return `    ${dim("$")} ${example}`;
}

export function formatSectionHeader(title: string): string {
  return bold(`${title}:`);
}

export function formatCommandHeader(commandName: string): string {
  return `\n  ${bold(brand(`veryfront ${commandName}`))}`;
}

export function calculateMaxLength(items: Array<{ length: number }>): number {
  return Math.max(...items.map((item) => item.length));
}

function commandDisplayName(cmd: CommandHelp): string {
  if (!cmd.aliases || cmd.aliases.length === 0) return cmd.name;
  return `${cmd.name} (${cmd.aliases.join(", ")})`;
}

export function formatCommandList(
  commands: CommandHelp[],
  maxNameLength?: number,
): string[] {
  const displayNames = commands.map(commandDisplayName);
  const padLength = maxNameLength ??
    calculateMaxLength(displayNames.map((n) => ({ length: n.length })));
  return commands.map(
    (cmd, i) =>
      `    ${formatCommandName(displayNames[i]!, padLength)} ${formatDescription(cmd.description)}`,
  );
}
