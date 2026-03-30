export type CommandCategory =
  | "development"
  | "deploy"
  | "project"
  | "files"
  | "ai"
  | "auth";

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
}

export type CommandRegistry = Record<string, CommandHelp>;
