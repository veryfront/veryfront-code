import { VERSION } from "@veryfront/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { bold, brand, dim, muted } from "../ui/colors.ts";

export function formatHeader(): string {
  return "\n  " + bold(brand("veryfront")) + " " + dim(`v${VERSION}`);
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
  return bold(title + ":");
}

export function formatCommandHeader(commandName: string): string {
  return `\n  ${bold(brand(`veryfront ${commandName}`))}`;
}

export function formatAsciiLogo(): string {
  return `
${dim("────────────────────────────────────────")}
  ${bold(brand("veryfront"))}  ${dim("React meta-framework")}
${dim("────────────────────────────────────────")}
`;
}

export function calculateMaxLength(items: Array<{ length: number }>): number {
  return Math.max(...items.map((item) => item.length));
}

export function formatCommandList(commands: CommandHelp[]): string[] {
  const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  return commands.map((cmd) =>
    `    ${formatCommandName(cmd.name, maxLength)} ${formatDescription(cmd.description)}`
  );
}
