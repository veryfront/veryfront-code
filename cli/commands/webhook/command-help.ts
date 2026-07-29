import type { CommandHelp } from "../../help/types.ts";

export const webhookHelp: CommandHelp = {
  name: "webhook",
  category: "ai",
  description: "List or run source-defined webhooks",
  usage: "veryfront webhook <list|run> [options]",
  options: [
    {
      flag: "--payload <file>",
      description: "JSON payload fixture (run only)",
    },
    {
      flag: "--json",
      description: "Output as JSON",
    },
  ],
  examples: [
    "veryfront webhook list",
    "veryfront webhook list --json",
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json",
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json --json",
  ],
};
