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
import { error, muted } from "../ui/colors.ts";

export function showCommandHelp(command: string): void {
  const cmd = COMMANDS[command];

  if (!cmd) {
    console.log();
    console.log(`  ${error("✗")} Unknown command: ${command}`);
    console.log();
    showMainHelp();
    return;
  }

  console.log(formatCommandHeader(cmd.name));
  console.log(`  ${muted(cmd.description)}`);
  console.log();
  console.log(formatUsage(cmd.usage));

  const options = cmd.options ?? [];
  if (options.length > 0) {
    console.log(`  ${formatSectionHeader("Options")}`);
    const maxLength = calculateMaxLength(options.map((o) => ({ length: o.flag.length })));

    for (const opt of options) {
      console.log(formatOption(opt, maxLength));
    }
    console.log();
  }

  const examples = cmd.examples ?? [];
  if (examples.length > 0) {
    console.log(`  ${formatSectionHeader("Examples")}`);
    for (const example of examples) {
      console.log(formatExample(example));
    }
    console.log();
  }

  const tips = getCommandTips(command);
  if (tips) console.log(tips);
}
