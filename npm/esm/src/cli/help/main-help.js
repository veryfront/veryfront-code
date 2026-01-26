import { COMMANDS } from "./command-definitions.js";
import { calculateMaxLength, formatCommandList, formatCommandName, formatDescription, formatHeader, formatSectionHeader, } from "./formatters.js";
import { bold, dim } from "../ui/colors.js";
export function showMainHelp() {
    console.log(formatHeader());
    console.log();
    console.log(`  ${bold("Usage:")} veryfront <command> [options]`);
    console.log();
    console.log(`  ${formatSectionHeader("Commands")}`);
    const commands = Object.values(COMMANDS);
    for (const line of formatCommandList(commands)) {
        console.log(line);
    }
    const maxLength = calculateMaxLength(commands.map((c) => ({ length: c.name.length })));
    console.log();
    console.log(`  ${formatSectionHeader("Global Options")}`);
    console.log(`    ${formatCommandName("-h, --help", maxLength)} ${formatDescription("Show help")}`);
    console.log(`    ${formatCommandName("-v, --version", maxLength)} ${formatDescription("Show version")}`);
    console.log();
    console.log(`  ${formatSectionHeader("Quick Start")}`);
    console.log(`    ${dim("$")} veryfront init my-app`);
    console.log(`    ${dim("$")} cd my-app`);
    console.log(`    ${dim("$")} veryfront dev`);
    console.log();
    console.log(`  ${formatSectionHeader("Coding Agents (MCP)")}`);
    console.log(`    ${dim("HTTP:")}   MCP auto-starts on port 9999 with dev server`);
    console.log(`    ${dim("stdio:")}  veryfront mcp`);
    console.log(`    ${dim("Tools:")}  vf_list_templates, vf_create_project, vf_scaffold, ...`);
    console.log();
    console.log(`  ${formatSectionHeader("Learn More")}`);
    console.log(`    ${dim("Docs:")}  https://github.com/veryfront/veryfront`);
    console.log(`    ${dim("Tips:")}  veryfront <command> --help`);
    console.log();
}
