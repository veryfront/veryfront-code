import { VERSION } from "#veryfront/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { bold, brand, dim, muted, shouldUseColor } from "../ui/colors.ts";
import { AGENT_FACE } from "../ui/dot-matrix.ts";

const RESET = "\x1b[0m";

/**
 * Render a small inline logo for help header
 */
function renderMiniLogo(): string[] {
  const litColor = shouldUseColor() ? "\x1b[38;2;0;163;244m" : "";
  const offColor = shouldUseColor() ? "\x1b[38;5;240m" : "";

  const result: string[] = [];
  for (const row of AGENT_FACE) {
    const dots = row.map((dot) => {
      if (dot === 1) {
        return `${litColor}●${RESET}`;
      }
      return `${offColor}○${RESET}`;
    });
    result.push(dots.join(" "));
  }
  return result;
}

export function formatHeader(): string {
  const logoLines = renderMiniLogo();
  const textLines = [
    "",
    bold(brand("veryfront")) + " " + dim(`v${VERSION}`),
    dim("A Deno-first React framework"),
    "",
    "",
    "",
    "",
  ];

  // Combine logo and text horizontally
  const output: string[] = [""];
  const maxHeight = Math.max(logoLines.length, textLines.length);
  for (let i = 0; i < maxHeight; i++) {
    const logoLine = logoLines[i] || "             "; // Logo width ~13 chars
    const textLine = textLines[i] || "";
    output.push(`  ${logoLine}   ${textLine}`);
  }

  return output.join("\n");
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
