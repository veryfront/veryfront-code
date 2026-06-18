import type { CommandHelp } from "../../help/types.ts";

export const skillsHelp: CommandHelp = {
  name: "skills",
  category: "ai",
  description: "List and inspect available agent skills",
  usage: "veryfront skills [subcommand] [options]",
  options: [
    { flag: "--json", description: "Output as JSON" },
  ],
  examples: [
    "veryfront skills list",
    "veryfront skills list --json",
    "veryfront skills info scaffold-app",
    "veryfront skills info deploy-safely --json",
    "veryfront skills create my-skill",
    "veryfront skills validate ./skills/my-skill",
  ],
  notes: [
    "Subcommands: list (default), info, create, validate",
    "Skills provide step-by-step agent workflows using CLI commands and MCP tools",
  ],
};
