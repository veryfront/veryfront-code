/**
 * Type definitions for CLI help system
 * @module
 */

/**
 * Command option configuration
 */
export interface CommandOption {
  /** Option flag (e.g., "-p, --port <number>") */
  flag: string;
  /** Description of what the option does */
  description: string;
  /** Default value for the option */
  default?: string;
}

/**
 * Complete help information for a CLI command
 */
export interface CommandHelp {
  /** Command name */
  name: string;
  /** Brief description of the command */
  description: string;
  /** Usage pattern string */
  usage: string;
  /** Available options for the command */
  options?: CommandOption[];
  /** Example usage strings */
  examples?: string[];
  /** Additional notes or tips */
  notes?: string[];
}

/**
 * Registry of all available commands
 */
export type CommandRegistry = Record<string, CommandHelp>;
