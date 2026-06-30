import type { CommandHelp } from "../../help/types.ts";

export const webhookHelp: CommandHelp = {
  name: "webhook",
  category: "ai",
  description: "Run a source-defined webhook locally with a fixture payload",
  usage: "veryfront webhook run <id> --payload <file> [options]",
  options: [
    {
      flag: "--payload <file>",
      description: "JSON payload fixture",
    },
    {
      flag: "--json",
      description: "Output the run result as JSON",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json",
    "veryfront webhook run ticket-created --payload fixtures/ticket-created.json --json",
  ],
};
