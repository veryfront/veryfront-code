import type { CommandHelp } from "../../help/types.ts";

export const envHelp: CommandHelp = {
  name: "env",
  category: "deploy",
  description: "Manage environment variables for deployments",
  usage: "veryfront env <subcommand> [options]",
  options: [
    {
      flag: "--env <name>",
      description: "Target environment",
      default: "production",
    },
    { flag: "--json", description: "Output as JSON" },
  ],
  examples: [
    "veryfront env list",
    "veryfront env set KEY=value",
    "veryfront env remove KEY",
    "veryfront env pull .env.local",
    "veryfront env push .env.production",
  ],
  notes: [
    "Requires authentication. Run 'veryfront login' first.",
    "Subcommands: list, set, remove, pull, push",
  ],
};
