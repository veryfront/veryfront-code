export const COMMAND_CATEGORIES = [
  "development",
  "deploy",
  "project",
  "files",
  "ai",
  "auth",
] as const;

export type CommandCategory = typeof COMMAND_CATEGORIES[number];

export interface CommandOption {
  flag: string;
  description: string;
  default?: string;
}

export interface CommandHelp {
  name: string;
  category: CommandCategory;
  description: string;
  usage: string;
  options?: CommandOption[];
  examples?: string[];
  notes?: string[];
  /** Aliases shown inline in main help, e.g. ["g"] for generate */
  aliases?: string[];
  /** When true, hidden from main help unless --all is passed */
  hidden?: boolean;
}

export type CommandRegistry = Record<string, CommandHelp>;
