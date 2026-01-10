import { bold, cyan, dim, green, yellow } from "@veryfront/compat/console";
import { VERSION } from "@veryfront/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { getColorEnabled } from "../utils/index.ts";

function c<T extends (s: string) => string>(colorFn: T, text: string): string {
  return getColorEnabled() ? colorFn(text) : text;
}

export function formatHeader(): string {
  return c(bold, c(cyan, "\n⚡ Veryfront")) + c(dim, ` v${VERSION}\n`);
}

export function formatCommandName(name: string, paddingLength: number): string {
  return c(green, name.padEnd(paddingLength + 2));
}

export function formatDescription(description: string): string {
  return c(dim, description);
}

export function formatUsage(usage: string): string {
  return `${c(yellow, "Usage:")} ${usage}\n`;
}

export function formatOptionFlag(flag: string, paddingLength: number): string {
  return c(green, flag.padEnd(paddingLength + 2));
}

export function formatOption(option: CommandOption, paddingLength: number): string {
  const defaultStr = option.default ? c(dim, ` (default: ${option.default})`) : "";
  return `  ${formatOptionFlag(option.flag, paddingLength)} ${option.description}${defaultStr}`;
}

export function formatExample(example: string): string {
  return `  ${c(dim, "$")} ${c(cyan, example)}`;
}

export function formatSectionHeader(title: string): string {
  return c(yellow, title + ":");
}

export function formatCommandHeader(commandName: string): string {
  return `${c(bold, c(cyan, `\n⚡ Veryfront ${commandName}`))}\n`;
}

export function formatAsciiLogo(): string {
  return `
${c(cyan, "╔══════════════════════════════════════╗")}
${c(cyan, "║")}  ⚡  ${c(bold, "VERYFRONT")}                      ${c(cyan, "║")}
${c(cyan, "║")}  ${c(dim, "Deno-First React Framework")}        ${c(cyan, "║")}
${c(cyan, "╚══════════════════════════════════════╝")}
`;
}

export function calculateMaxLength(items: Array<{ length: number }>): number {
  return Math.max(...items.map((item) => item.length));
}

export function formatCommandList(commands: CommandHelp[]): string[] {
  const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  return commands.map((cmd) =>
    `  ${formatCommandName(cmd.name, maxLength)} ${formatDescription(cmd.description)}`
  );
}
