export interface CommandOption {
    flag: string;
    description: string;
    default?: string;
}
export interface CommandHelp {
    name: string;
    description: string;
    usage: string;
    options?: CommandOption[];
    examples?: string[];
    notes?: string[];
}
export type CommandRegistry = Record<string, CommandHelp>;
//# sourceMappingURL=types.d.ts.map