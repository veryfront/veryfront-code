import { VERSION } from "#cli/utils";
import type { CommandHelp, CommandOption } from "./types.ts";
import { bold, brand, dim, muted, shouldUseColor } from "../ui/colors.ts";
import { AGENT_FACE } from "../ui/dot-matrix.ts";

const RESET = "\x1b[0m";
const LOGO_FALLBACK = "             "; // Logo width ~13 chars

function renderMiniLogo(): string[] {
  const useColor = shouldUseColor();
  const litColor = useColor ? "\x1b[38;2;252;143;93m" : "";
  const offColor = useColor ? "\x1b[38;5;240m" : "";

  return AGENT_FACE.map((row) =>
    row
      .map((dot) => {
        const lit = dot === 1;
        return `${lit ? litColor : offColor}${lit ? "●" : "○"}${RESET}`;
      })
      .join(" ")
  );
}

export function formatHeader(): string {
  const logoLines = renderMiniLogo();
  const textLines = [
    "",
    `${bold(brand("veryfront"))} ${dim(`v${VERSION}`)}`,
    dim("A Deno-first React framework"),
    "",
    "",
    "",
    "",
  ];

  const maxHeight = Math.max(logoLines.length, textLines.length);
  const output: string[] = [""];

  for (let i = 0; i < maxHeight; i++) {
    output.push(`  ${logoLines[i] ?? LOGO_FALLBACK}   ${textLines[i] ?? ""}`);
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
  return bold(`${title}:`);
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

export function formatCommandList(
  commands: CommandHelp[],
  maxNameLength?: number,
): string[] {
  const padLength = maxNameLength ??
    calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
  return commands.map(
    (cmd) => `    ${formatCommandName(cmd.name, padLength)} ${formatDescription(cmd.description)}`,
  );
}
