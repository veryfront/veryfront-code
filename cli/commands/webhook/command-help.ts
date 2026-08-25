import type { CommandHelp } from "../../help/types.ts";

export const webhookHelp: CommandHelp = {
  name: "webhook",
  category: "ai",
  description: "List or run source-defined webhooks",
  usage: "veryfront webhook <list|run> [options]",
  options: [
    {
      flag: "--payload <file>",
      description:
        "JSON payload fixture (run only; 64 KiB maximum; filters and agent templates are applied)",
    },
    {
      flag: "-d, --dir <path>",
      description: "Project directory (default: current directory)",
    },
    {
      flag: "--json",
      description: "Output as JSON",
    },
    {
      flag: "--debug",
      description: "Enable debug logging (run only)",
    },
  ],
  examples: [
    "veryfront webhook list",
    "veryfront webhook list --json",
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json",
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json --json",
  ],
};
