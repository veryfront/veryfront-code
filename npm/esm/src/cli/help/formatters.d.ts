import type { CommandHelp, CommandOption } from "./types.js";
export declare function formatHeader(): string;
export declare function formatCommandName(name: string, paddingLength: number): string;
export declare function formatDescription(description: string): string;
export declare function formatUsage(usage: string): string;
export declare function formatOptionFlag(flag: string, paddingLength: number): string;
export declare function formatOption(option: CommandOption, paddingLength: number): string;
export declare function formatExample(example: string): string;
export declare function formatSectionHeader(title: string): string;
export declare function formatCommandHeader(commandName: string): string;
export declare function formatAsciiLogo(): string;
export declare function calculateMaxLength(items: Array<{
    length: number;
}>): number;
export declare function formatCommandList(commands: CommandHelp[]): string[];
//# sourceMappingURL=formatters.d.ts.map