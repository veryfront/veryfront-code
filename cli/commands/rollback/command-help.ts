import type { CommandHelp } from "../../help/types.ts";

export const rollbackHelp: CommandHelp = {
  name: "rollback",
  category: "deploy",
  description: "Rollback to a previous deployment",
  usage: "veryfront rollback [options]",
  options: [
    { flag: "--to <version>", description: "Rollback to specific version" },
    { flag: "--list", description: "Show recent deployments" },
    {
      flag: "--env <name>",
      description: "Target environment",
      default: "production",
    },
    { flag: "--json", description: "Output as JSON" },
    { flag: "-f, --force", description: "Skip confirmation" },
  ],
  examples: [
    "veryfront rollback",
    "veryfront rollback --to v42",
    "veryfront rollback --list",
    "veryfront rollback --list --json",
  ],
};
