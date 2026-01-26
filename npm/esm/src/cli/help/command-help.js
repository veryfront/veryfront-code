import { COMMANDS } from "./command-definitions.js";
import { calculateMaxLength, formatCommandHeader, formatExample, formatOption, formatSectionHeader, formatUsage, } from "./formatters.js";
import { getCommandTips } from "./tips.js";
import { showMainHelp } from "./main-help.js";
import { error, muted } from "../ui/colors.js";
export function showCommandHelp(command) {
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
    if (tips)
        console.log(tips);
}
